-- Exception-based reporting: only what breaches a threshold, ranked by money at stake.
-- Thresholds are deliberately explicit so the business can tune them.
{% set fy_start = "case when month(" ~ as_of() ~ ") >= 4 then make_date(year(" ~ as_of() ~ "), 4, 1) else make_date(year(" ~ as_of() ~ ") - 1, 4, 1) end" %}
with sites as (select site_id, site_name from {{ ref('sites') }}),
otif as (
    select site_id,
           count(*) filter (where otif) / count(*) as actual,
           sum(order_value_gbp) filter (where not otif) as impact_gbp,
           count(*) filter (where not otif) as late_lines
    from {{ ref('fct_order_line') }}
    where is_due and promised_date > {{ as_of() }} - 28
    group by 1
),
scrap as (
    select site_id,
           sum(scrap_qty) / nullif(sum(good_qty + scrap_qty), 0) as actual,
           sum(scrap_cost_gbp) as impact_gbp,
           mode(defect_text) filter (where defect_text is not null) as top_defect
    from {{ ref('fct_production_order') }}
    where status = 'Confirmed' and finish_date > {{ as_of() }} - 14
    group by 1
),
stock as (
    select i.site_id, m.days_of_inventory as actual, sum(i.excess_value_gbp) as impact_gbp
    from {{ ref('fct_inventory_position') }} i
    join {{ ref('mart_inventory_month') }} m
      on m.site_id = i.site_id and m.month_end = {{ as_of() }}
    group by 1, 2
),
supplier as (
    select site_id, supplier_id, supplier_name,
           count(*) filter (where on_time) / count(*) as actual,
           count(*) as lines_due,
           sum(value_gbp) filter (where status = 'Open' and due_date < {{ as_of() }}) as impact_gbp
    from {{ ref('fct_po_line') }}
    where supplier_is_critical and is_due and due_date > {{ as_of() }} - 56
    group by 1, 2, 3
    having count(*) >= 10
),
fytd as (
    select site_id,
           sum(revenue_gbp) as revenue, sum(revenue_budget_gbp) as budget,
           sum(margin_gbp) / nullif(sum(revenue_gbp), 0) as gm, sum(margin_budget_gbp) / nullif(sum(revenue_budget_gbp), 0) as gm_budget
    from {{ ref('mart_site_month') }}
    where is_complete_month and month_start >= {{ fy_start }}
    group by 1
),
rules as (
    select site_id, 'Delivery' as category, 'otif' as kpi_code, actual, 0.95 as target, 'pct' as unit,
           case when actual < 0.85 then 'High' else 'Medium' end as severity,
           impact_gbp,
           'OTIF ' || printf('%.0f', actual * 100) || '% over the last 4 weeks (target 95%)' as headline,
           late_lines || ' order lines late or short; ' || printf('£%.1fm', impact_gbp / 1e6) || ' of customer orders affected' as detail
    from otif where actual < 0.90
    union all
    select site_id, 'Quality', 'scrap_rate', actual, 0.03, 'pct',
           case when actual > 0.06 then 'High' else 'Medium' end,
           impact_gbp,
           'Scrap ' || printf('%.1f', actual * 100) || '% in the last 14 days (target 3%)',
           printf('£%.0fk', impact_gbp / 1e3) || ' scrapped at standard cost; main defect: ' || coalesce(top_defect, 'n/a')
    from scrap where actual > 0.045
    union all
    select site_id, 'Working capital', 'days_of_inventory', actual, 45, 'days',
           case when actual > 90 then 'High' else 'Medium' end,
           impact_gbp,
           printf('%.0f', actual) || ' days of finished-goods inventory (target 45)',
           printf('£%.1fm', impact_gbp / 1e6) || ' of stock is above 60 days of cover'
    from stock where actual > 60
    union all
    select site_id, 'Supply', 'supplier_otd', actual, 0.92, 'pct',
           case when actual < 0.70 then 'High' else 'Medium' end,
           coalesce(impact_gbp, 0),
           supplier_name || ' on time ' || printf('%.0f', actual * 100) || '% over 8 weeks (target 92%)',
           'Critical supplier; ' || printf('£%.0fk', coalesce(impact_gbp, 0) / 1e3) || ' of purchase orders overdue'
    from supplier where actual < 0.85
    union all
    select site_id, 'Financial', 'revenue_vs_plan', revenue / budget - 1, 0, 'pct',
           case when revenue / budget - 1 < -0.08 then 'High' else 'Medium' end,
           budget - revenue,
           'Revenue ' || printf('%+.1f', (revenue / budget - 1) * 100) || '% vs plan, financial year to date',
           printf('£%.1fm', (budget - revenue) / 1e6) || ' behind budget on completed months'
    from fytd where revenue / budget - 1 < -0.05
    union all
    select site_id, 'Financial', 'gross_margin_pct', gm, gm_budget, 'pct',
           case when gm - gm_budget < -0.025 then 'High' else 'Medium' end,
           (gm_budget - gm) * revenue,
           'Gross margin ' || printf('%.1f', gm * 100) || '% vs ' || printf('%.1f', gm_budget * 100) || '% plan',
           printf('£%.1fm', (gm_budget - gm) * revenue / 1e6) || ' of margin below plan, financial year to date'
    from fytd where gm - gm_budget < -0.015
)
select
    md5(r.site_id || r.kpi_code || r.headline) as exception_id,
    r.site_id,
    s.site_name,
    r.category,
    r.kpi_code,
    round(r.actual, 4) as actual,
    r.target,
    r.unit,
    r.severity,
    round(r.impact_gbp, 0) as impact_gbp,
    r.headline,
    r.detail,
    {{ as_of() }} as detected_on
from rules r
join sites s using (site_id)
order by case r.severity when 'High' then 0 else 1 end, r.impact_gbp desc
