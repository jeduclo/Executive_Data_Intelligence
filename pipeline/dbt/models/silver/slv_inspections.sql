select
    inspection_lot,
    production_order as production_order_id,
    s.site_id,
    cast(inspection_date as date) as inspection_date,
    result,
    first_pass = 'Y' as passed_first_time,
    nullif(defect_code, '') as defect_code,
    nullif(defect_text, '') as defect_text,
    cast(inspected_qty as integer) as inspected_qty
from {{ source('bronze', 'qms_inspections') }} q
join {{ ref('sites') }} s on s.plant_code = q.plant
