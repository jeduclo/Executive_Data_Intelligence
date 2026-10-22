-- Grain: one production order, with its inspection lot result and scrap valued at standard cost
with p as (select * from {{ ref('slv_production_orders') }}),
i as (select * from {{ ref('slv_inspections') }})
select
    p.production_order_id,
    p.site_id,
    p.material_id,
    m.family,
    p.work_centre,
    p.release_date,
    p.start_date,
    p.finish_date,
    p.status,
    p.planned_qty,
    p.good_qty,
    p.scrap_qty,
    p.ideal_minutes,
    p.run_minutes,
    p.downtime_minutes,
    i.inspection_lot,
    i.passed_first_time,
    i.defect_code,
    i.defect_text,
    round(p.scrap_qty * c.std_cost_local / fx.rate_per_gbp, 2) as scrap_cost_gbp
from p
join {{ ref('sites') }} s using (site_id)
left join {{ ref('slv_materials') }} m using (material_id)
left join i using (production_order_id)
left join {{ ref('slv_cost_standards') }} c
    on c.material_id = p.material_id and c.plant_code = s.plant_code
   and p.finish_date between c.valid_from and c.valid_to
left join {{ ref('slv_fx_rates') }} fx on fx.rate_date = least(p.finish_date, {{ as_of() }}) and fx.currency = s.currency
