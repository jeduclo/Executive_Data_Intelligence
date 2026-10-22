select
    lifnr as supplier_id,
    name1 as supplier_name,
    land1 as country,
    case zzcateg
        when 'CAS' then 'Castings' when 'BRG' then 'Bearings' when 'ELE' then 'Electronics'
        when 'STL' then 'Steel bar & plate' when 'SEA' then 'Seals & gaskets' else 'Fasteners' end as category,
    zzcritical = 'X' as is_critical
from {{ source('bronze', 'erp_suppliers') }}
