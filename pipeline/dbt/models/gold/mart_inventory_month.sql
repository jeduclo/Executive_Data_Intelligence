-- Finished-goods inventory value and days of inventory at each month end (current month: as of date)
with months as (
    select least(cast(m + interval 1 month - interval 1 day as date), {{ as_of() }}) as month_end,
           cast(m as date) as month_start
    from range(date '2025-04-01', cast(date_trunc('month', {{ as_of() }}) + interval 1 month as date), interval 1 month) t(m)
),
moves as (
    select site_id, material_id, cast(date_trunc('month', posting_date) as date) as month_start, sum(qty) as qty
    from {{ ref('slv_stock_movements') }}
    where posting_date <= {{ as_of() }}
    group by 1, 2, 3
),
opening as (  -- everything posted before the first reporting month
    select site_id, material_id, sum(qty) as qty from moves where month_start < date '2025-04-01' group by 1, 2
),
grid as (
    select s.site_id, s.material_id, mo.month_start, mo.month_end
    from (select distinct site_id, material_id from moves) s cross join months mo
),
running as (
    select g.*,
           coalesce(o.qty, 0) + sum(coalesce(m.qty, 0)) over (partition by g.site_id, g.material_id order by g.month_start) as qty_on_hand
    from grid g
    left join moves m using (site_id, material_id, month_start)
    left join opening o using (site_id, material_id)
),
valued as (
    select r.site_id, r.month_start, r.month_end,
           sum(greatest(r.qty_on_hand, 0) * c.std_cost_local / fx.rate_per_gbp) as inventory_value_gbp
    from running r
    join {{ ref('sites') }} s using (site_id)
    left join {{ ref('slv_cost_standards') }} c
        on c.material_id = r.material_id and c.plant_code = s.plant_code and r.month_end between c.valid_from and c.valid_to
    left join {{ ref('slv_fx_rates') }} fx on fx.rate_date = r.month_end and fx.currency = s.currency
    group by 1, 2, 3
),
cogs as (
    select v.site_id, v.month_start, sum(f.cost_gbp) as cogs_90d_gbp
    from valued v
    join {{ ref('fct_order_line') }} f
      on f.site_id = v.site_id and f.invoice_date > v.month_end - 90 and f.invoice_date <= v.month_end
    group by 1, 2
)
select v.site_id, v.month_start, v.month_end,
       round(v.inventory_value_gbp, 2) as inventory_value_gbp,
       round(c.cogs_90d_gbp, 2) as cogs_90d_gbp,
       round(v.inventory_value_gbp / nullif(c.cogs_90d_gbp / 90.0, 0), 1) as days_of_inventory
from valued v
left join cogs c using (site_id, month_start)
