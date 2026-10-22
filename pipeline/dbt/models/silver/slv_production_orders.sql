select
    order_no as production_order_id,
    s.site_id,
    material as material_id,
    work_centre,
    {{ mixed_date('release_date') }} as release_date,
    {{ mixed_date('start_date') }} as start_date,
    {{ mixed_date('finish_date') }} as finish_date,
    case status when 'CNF' then 'Confirmed' when 'REL' then 'In progress' else 'Planned' end as status,
    cast(planned_qty as integer) as planned_qty,
    cast(good_qty as integer) as good_qty,
    cast(scrap_qty as integer) as scrap_qty,
    cast(planned_minutes as integer) as ideal_minutes,
    cast(run_minutes as integer) as run_minutes,
    cast(downtime_minutes as integer) as downtime_minutes,
    release_date like '%.%' as source_date_non_iso
from {{ source('bronze', 'mes_production_orders') }} p
join {{ ref('sites') }} s on s.plant_code = p.plant
qualify row_number() over (partition by order_no order by _dlt_load_id desc) = 1
