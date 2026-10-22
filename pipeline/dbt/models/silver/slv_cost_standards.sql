-- Standard cost versions with validity ranges (SAP MBEW history)
with v as (
    select
        matnr as material_id,
        bwkey as plant_code,
        cast(stprs as double) / cast(peinh as double) as std_cost_local,
        waers as currency,
        {{ odata_date('valid_from') }} as valid_from
    from {{ source('bronze', 'erp_cost_standards') }}
)
select
    *,
    coalesce(lead(valid_from) over (partition by material_id, plant_code order by valid_from) - 1,
             date '9999-12-31') as valid_to
from v
