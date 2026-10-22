"""Security model for the serving layer (PostgreSQL).

Row-level security (RLS): every table with a site_id column only returns rows
for the sites the signed-in user may see (sec.user_access / sec.user_site_access).

Column-level security (CLS): roles get SELECT on an explicit column list.
Cost and margin columns are withheld from site managers; all money columns
are withheld from customer service.

The portal connects as `portal_app`, which has NO privileges of its own. Per
request it runs `SET LOCAL ROLE <persona role>` and sets `app.user_id`, so a
query that forgets to do this simply fails. Power BI would map the same
sec.* tables into its own RLS/OLS roles.
"""
from __future__ import annotations

from psycopg import sql as pgsql

ROLES = {
    "rpt_executive": "Group executives: all sites, all columns",
    "rpt_finance": "Finance: assigned sites, all columns",
    "rpt_site_manager": "Plant managers: own site, no cost or margin columns",
    "rpt_customer_service": "Customer service: order status only, no money columns",
}

PERSONAS = [
    # user_id, name, title, role, all_sites, sites
    ("ceo", "Helen Carter", "Group Chief Executive", "rpt_executive", True, []),
    ("cfo", "Alex Morgan", "Group CFO", "rpt_executive", True, []),
    ("fin_uk", "Priya Shah", "Finance Business Partner, UK", "rpt_finance", False, [1, 2]),
    ("pm_stuttgart", "Jonas Weber", "Plant Manager, Stuttgart", "rpt_site_manager", False, [3]),
    ("cs_agent", "Maria Lopez", "Customer Service Lead", "rpt_customer_service", True, []),
]

COST_MARGIN = {"cost_gbp", "margin_gbp", "cogs_gbp", "margin_budget_gbp", "std_cost_gbp", "cogs_90d_gbp"}
MONEY = COST_MARGIN | {"unit_price_local", "net_value_local", "order_value_gbp", "open_value_gbp", "revenue_gbp",
                       "revenue_budget_gbp", "late_value_gbp", "value_gbp", "excess_value_gbp", "scrap_cost_gbp",
                       "impact_gbp", "inventory_value_gbp"}

# Which gold tables customer service may read at all
CUSTOMER_SERVICE_TABLES = {"dim_site", "dim_customer", "dim_material", "fct_order_line", "kpi_definitions"}


def _q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def statements(tables: dict[str, list[str]], app_password: str | None,
               powerbi_password: str | None = None) -> list[tuple[str, tuple]]:
    """tables: {"gold.fct_order_line": [columns...], ...}. Returns (sql, params) pairs."""
    out: list[tuple[str, tuple]] = []
    add = lambda sql, *p: out.append((sql, p))  # noqa: E731

    for role in ROLES:
        add(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
            f"THEN CREATE ROLE {role} NOLOGIN; END IF; END $$")
    if app_password:
        add("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') "
            "THEN CREATE ROLE portal_app LOGIN NOINHERIT; END IF; END $$")
        add(pgsql.SQL("ALTER ROLE portal_app WITH LOGIN NOINHERIT PASSWORD {}").format(pgsql.Literal(app_password)))
        for role in ROLES:
            add(f"GRANT {role} TO portal_app")
        add("DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO portal_app', current_database()); END $$")

    # --- entitlement tables
    add("CREATE SCHEMA IF NOT EXISTS sec")
    add("""CREATE TABLE IF NOT EXISTS sec.user_access (
             user_id text PRIMARY KEY, display_name text NOT NULL, title text NOT NULL,
             db_role text NOT NULL, all_sites boolean NOT NULL DEFAULT false)""")
    add("ALTER TABLE sec.user_access ADD COLUMN IF NOT EXISTS is_service boolean NOT NULL DEFAULT false")
    add("CREATE TABLE IF NOT EXISTS sec.sites (site_id int PRIMARY KEY)")
    add("""CREATE TABLE IF NOT EXISTS sec.user_site_access (
             user_id text REFERENCES sec.user_access ON DELETE CASCADE, site_id int, PRIMARY KEY (user_id, site_id))""")
    for uid, name, title, role, all_sites, sites in PERSONAS:
        add("""INSERT INTO sec.user_access VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, title = EXCLUDED.title,
                 db_role = EXCLUDED.db_role, all_sites = EXCLUDED.all_sites""", uid, name, title, role, all_sites)
        add("DELETE FROM sec.user_site_access WHERE user_id = %s", uid)
        for s in sites:
            add("INSERT INTO sec.user_site_access VALUES (%s, %s)", uid, s)

    # Sites visible to the current app user. SECURITY DEFINER so report roles
    # never need to read the entitlement tables themselves.
    add("""CREATE OR REPLACE FUNCTION sec.my_sites() RETURNS int[]
           LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sec, pg_temp AS $$
             SELECT coalesce(array_agg(s.site_id), '{}')
             FROM sec.sites s
             JOIN sec.user_access u ON u.user_id = coalesce(nullif(current_setting('app.user_id', true), ''), session_user::text)
             WHERE u.all_sites OR EXISTS (SELECT 1 FROM sec.user_site_access a
                                          WHERE a.user_id = u.user_id AND a.site_id = s.site_id)
           $$""")
    # Invoker function: is the *current role* entitled to margin information?
    add("""CREATE OR REPLACE FUNCTION sec.sees_margin() RETURNS boolean LANGUAGE sql STABLE AS $$
             SELECT current_user IN ('rpt_executive', 'rpt_finance')
           $$""")
    add("DROP FUNCTION IF EXISTS sec.whoami()")
    add("""CREATE FUNCTION sec.whoami() RETURNS TABLE(user_id text, display_name text, title text, sites int[])
           LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sec, pg_temp AS $$
             SELECT u.user_id, u.display_name, u.title, sec.my_sites()
             FROM sec.user_access u WHERE u.user_id = current_setting('app.user_id', true)
           $$""")
    # Login screen: the portal may list personas and look up a persona's role (nothing else)
    add("""CREATE OR REPLACE FUNCTION sec.list_personas()
           RETURNS TABLE(user_id text, display_name text, title text, db_role text, all_sites boolean, site_ids int[])
           LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sec, pg_temp AS $$
             SELECT u.user_id, u.display_name, u.title, u.db_role, u.all_sites,
                    coalesce((SELECT array_agg(a.site_id ORDER BY a.site_id) FROM sec.user_site_access a
                              WHERE a.user_id = u.user_id), '{}')
             FROM sec.user_access u WHERE NOT u.is_service ORDER BY u.all_sites DESC, u.db_role, u.user_id
           $$""")
    add("REVOKE ALL ON FUNCTION sec.list_personas() FROM PUBLIC")
    add("REVOKE ALL ON ALL TABLES IN SCHEMA sec FROM PUBLIC")

    roles = ", ".join(ROLES)
    for schema in ("gold", "sec", "ops"):
        add(f"CREATE SCHEMA IF NOT EXISTS {schema}")
        add(f"GRANT USAGE ON SCHEMA {schema} TO {roles}")
    add(f"GRANT EXECUTE ON FUNCTION sec.my_sites(), sec.sees_margin(), sec.whoami() TO {roles}")
    add(f"GRANT SELECT ON ALL TABLES IN SCHEMA ops TO {roles}")

    # --- per-table RLS + CLS
    for fq, cols in tables.items():
        schema, name = fq.split(".")
        if schema != "gold":
            continue
        t = f"gold.{_q(name)}"
        add(f"REVOKE ALL ON {t} FROM PUBLIC, {roles}")
        if "site_id" in cols:
            add(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
            add(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
            add(f"DROP POLICY IF EXISTS site_rls ON {t}")
            extra = " AND (kpi_code <> 'gross_margin_pct' OR (SELECT sec.sees_margin()))" if name == "mart_exceptions" else ""
            add(f"CREATE POLICY site_rls ON {t} FOR SELECT USING (site_id IN (SELECT unnest(sec.my_sites())){extra})")
        add(f"GRANT SELECT ON {t} TO rpt_executive, rpt_finance")
        sm_cols = [c for c in cols if c not in COST_MARGIN]
        add(f"GRANT SELECT ({', '.join(_q(c) for c in sm_cols)}) ON {t} TO rpt_site_manager")
        if name in CUSTOMER_SERVICE_TABLES:
            cs_cols = [c for c in cols if c not in MONEY]
            add(f"GRANT SELECT ({', '.join(_q(c) for c in cs_cols)}) ON {t} TO rpt_customer_service")
    if powerbi_password:
        # Service login for Power BI. It cannot set app.user_id per query, so sec.my_sites()
        # falls back to the login name; Power BI applies per-user RLS in its own model.
        add("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') "
            "THEN CREATE ROLE powerbi_reader LOGIN; END IF; END $$")
        add(pgsql.SQL("ALTER ROLE powerbi_reader WITH LOGIN INHERIT PASSWORD {}").format(pgsql.Literal(powerbi_password)))
        add("GRANT rpt_executive TO powerbi_reader")
        add("DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO powerbi_reader', current_database()); END $$")
        add("""INSERT INTO sec.user_access (user_id, display_name, title, db_role, all_sites, is_service)
               VALUES ('powerbi_reader', 'Power BI service', 'Service account', 'rpt_executive', true, true)
               ON CONFLICT (user_id) DO UPDATE SET all_sites = true, is_service = true""")
    if app_password:
        add("GRANT USAGE ON SCHEMA sec TO portal_app")
        add("GRANT EXECUTE ON FUNCTION sec.list_personas() TO portal_app")
    return out
