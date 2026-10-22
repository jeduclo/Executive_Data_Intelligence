-- Grain: site x ISO week (Monday) for the last 26 weeks. Operational trend lines.
with weeks as (
    select cast(w as date) as week_start
    from range(cast(date_trunc('week', {{ as_of() }}) as date) - 25 * 7,
               cast(date_trunc('week', {{ as_of() }}) as date) + 1, interval 7 day) t(w)
),
grid as (select s.site_id, w.week_start from {{ ref('sites') }} s cross join weeks w),
dlv as (
    select site_id, cast(date_trunc('week', promised_date) as date) as week_start,
           count(*) as lines_due, count(*) filter (where otif) as lines_otif,
           sum(order_value_gbp) filter (where not otif) as late_value_gbp
    from {{ ref('fct_order_line') }} where is_due group by 1, 2
),
rev as (
    select site_id, cast(date_trunc('week', invoice_date) as date) as week_start,
           sum(revenue_gbp) as revenue_gbp, sum(margin_gbp) as margin_gbp
    from {{ ref('fct_order_line') }} where invoice_date <= {{ as_of() }} group by 1, 2
),
prod as (
    select site_id, cast(date_trunc('week', finish_date) as date) as week_start,
           sum(good_qty) as good_qty, sum(scrap_qty) as scrap_qty, sum(scrap_cost_gbp) as scrap_cost_gbp,
           count(inspection_lot) as lots, count(*) filter (where passed_first_time) as lots_ok,
           sum(ideal_minutes) as ideal_minutes, sum(run_minutes) as run_minutes, sum(downtime_minutes) as downtime_minutes
    from {{ ref('fct_production_order') }} where status = 'Confirmed' group by 1, 2
),
sup as (
    select site_id, cast(date_trunc('week', due_date) as date) as week_start,
           count(*) as po_lines_due, count(*) filter (where on_time) as po_lines_on_time
    from {{ ref('fct_po_line') }} where is_due group by 1, 2
)
select
    g.site_id, g.week_start,
    g.week_start + 6 >= {{ as_of() }} as is_current_week,
    coalesce(rev.revenue_gbp, 0) as revenue_gbp,
    coalesce(rev.margin_gbp, 0) as margin_gbp,
    dlv.lines_due, dlv.lines_otif,
    round(dlv.lines_otif / nullif(dlv.lines_due, 0), 4) as otif_pct,
    round(coalesce(dlv.late_value_gbp, 0), 2) as late_value_gbp,
    prod.good_qty, prod.scrap_qty,
    round(coalesce(prod.scrap_cost_gbp, 0), 2) as scrap_cost_gbp,
    round(prod.scrap_qty / nullif(prod.good_qty + prod.scrap_qty, 0), 4) as scrap_rate,
    round(prod.lots_ok / nullif(prod.lots, 0), 4) as first_pass_yield,
    round(((prod.run_minutes - prod.downtime_minutes) / nullif(prod.run_minutes, 0))
        * least(prod.ideal_minutes / nullif(prod.run_minutes - prod.downtime_minutes, 0), 1)
        * (prod.good_qty / nullif(prod.good_qty + prod.scrap_qty, 0)), 4) as oee,
    sup.po_lines_due, sup.po_lines_on_time,
    round(sup.po_lines_on_time / nullif(sup.po_lines_due, 0), 4) as supplier_otd
from grid g
left join dlv using (site_id, week_start)
left join rev using (site_id, week_start)
left join prod using (site_id, week_start)
left join sup using (site_id, week_start)
