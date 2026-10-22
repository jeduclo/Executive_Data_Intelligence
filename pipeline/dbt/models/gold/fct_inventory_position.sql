-- Grain: site x finished good, as of the reporting date
with stock as (
    select site_id, material_id, sum(qty) as qty_on_hand,
           max(posting_date) filter (where movement_type = '601') as last_issue_date
    from {{ ref('slv_stock_movements') }}
    where posting_date <= {{ as_of() }}
    group by 1, 2
),
demand as (
    select site_id, material_id, -sum(qty) / 90.0 as avg_daily_demand
    from {{ ref('slv_stock_movements') }}
    where movement_type = '601' and posting_date > {{ as_of() }} - 90 and posting_date <= {{ as_of() }}
    group by 1, 2
),
priced as (
    select st.*, coalesce(d.avg_daily_demand, 0) as avg_daily_demand,
           c.std_cost_local / fx.rate_per_gbp as std_cost_gbp
    from stock st
    join {{ ref('sites') }} s using (site_id)
    left join demand d using (site_id, material_id)
    left join {{ ref('slv_cost_standards') }} c
        on c.material_id = st.material_id and c.plant_code = s.plant_code
       and {{ as_of() }} between c.valid_from and c.valid_to
    left join {{ ref('slv_fx_rates') }} fx on fx.rate_date = {{ as_of() }} and fx.currency = s.currency
)
select
    p.site_id,
    p.material_id,
    m.family,
    greatest(p.qty_on_hand, 0) as qty_on_hand,
    round(p.avg_daily_demand, 3) as avg_daily_demand,
    case when p.avg_daily_demand > 0 then round(greatest(p.qty_on_hand, 0) / p.avg_daily_demand, 1) end as days_cover,
    p.last_issue_date,
    round(p.std_cost_gbp, 2) as std_cost_gbp,
    round(greatest(p.qty_on_hand, 0) * p.std_cost_gbp, 2) as value_gbp,
    round(greatest(p.qty_on_hand - 60 * p.avg_daily_demand, 0) * p.std_cost_gbp, 2) as excess_value_gbp
from priced p
left join {{ ref('slv_materials') }} m using (material_id)
