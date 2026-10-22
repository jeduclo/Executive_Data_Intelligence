-- Grain: site x month. Every governed KPI, actual vs budget/target.
with months as (
    select cast(m as date) as month_start
    from range(date '2025-04-01', cast(date_trunc('month', {{ as_of() }}) + interval 1 month as date), interval 1 month) t(m)
),
grid as (select s.site_id, m.month_start from {{ ref('sites') }} s cross join months m),
rev as (
    select site_id, cast(date_trunc('month', invoice_date) as date) as month_start,
           sum(revenue_gbp) as revenue_gbp, sum(cost_gbp) as cogs_gbp, sum(margin_gbp) as margin_gbp
    from {{ ref('fct_order_line') }} where invoice_date <= {{ as_of() }} group by 1, 2
),
dlv as (
    select site_id, cast(date_trunc('month', promised_date) as date) as month_start,
           count(*) as lines_due, count(*) filter (where otif) as lines_otif,
           count(*) filter (where on_time) as lines_on_time
    from {{ ref('fct_order_line') }} where is_due group by 1, 2
),
prod as (
    select site_id, cast(date_trunc('month', finish_date) as date) as month_start,
           sum(good_qty) as good_qty, sum(scrap_qty) as scrap_qty, sum(scrap_cost_gbp) as scrap_cost_gbp,
           sum(ideal_minutes) as ideal_minutes, sum(run_minutes) as run_minutes, sum(downtime_minutes) as downtime_minutes,
           count(inspection_lot) as inspection_lots, count(*) filter (where passed_first_time) as lots_passed_first_time
    from {{ ref('fct_production_order') }} where status = 'Confirmed' group by 1, 2
),
sup as (
    select site_id, cast(date_trunc('month', due_date) as date) as month_start,
           count(*) as po_lines_due, count(*) filter (where on_time) as po_lines_on_time
    from {{ ref('fct_po_line') }} where is_due group by 1, 2
)
select
    g.site_id,
    g.month_start,
    case when month(g.month_start) >= 4
         then 'FY' || year(g.month_start) || '/' || right(cast(year(g.month_start) + 1 as varchar), 2)
         else 'FY' || (year(g.month_start) - 1) || '/' || right(cast(year(g.month_start) as varchar), 2) end as fiscal_year,
    g.month_start + interval 1 month <= {{ as_of() }} as is_complete_month,
    coalesce(rev.revenue_gbp, 0) as revenue_gbp,
    coalesce(rev.cogs_gbp, 0) as cogs_gbp,
    coalesce(rev.margin_gbp, 0) as margin_gbp,
    b.revenue_budget_gbp,
    b.margin_budget_gbp,
    dlv.lines_due, dlv.lines_otif, dlv.lines_on_time,
    round(dlv.lines_otif / nullif(dlv.lines_due, 0), 4) as otif_pct,
    prod.good_qty, prod.scrap_qty, round(prod.scrap_cost_gbp, 2) as scrap_cost_gbp,
    round(prod.scrap_qty / nullif(prod.good_qty + prod.scrap_qty, 0), 4) as scrap_rate,
    round(prod.lots_passed_first_time / nullif(prod.inspection_lots, 0), 4) as first_pass_yield,
    round(((prod.run_minutes - prod.downtime_minutes) / nullif(prod.run_minutes, 0))
        * least(prod.ideal_minutes / nullif(prod.run_minutes - prod.downtime_minutes, 0), 1)
        * (prod.good_qty / nullif(prod.good_qty + prod.scrap_qty, 0)), 4) as oee,
    sup.po_lines_due, sup.po_lines_on_time,
    round(sup.po_lines_on_time / nullif(sup.po_lines_due, 0), 4) as supplier_otd,
    inv.inventory_value_gbp,
    inv.days_of_inventory
from grid g
left join rev using (site_id, month_start)
left join {{ ref('fct_budget_month') }} b using (site_id, month_start)
left join dlv using (site_id, month_start)
left join prod using (site_id, month_start)
left join sup using (site_id, month_start)
left join {{ ref('mart_inventory_month') }} inv using (site_id, month_start)
