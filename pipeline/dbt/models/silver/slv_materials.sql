select
    matnr as material_id,
    maktx as description,
    matkl as family_code,
    case matkl
        when 'GEA' then 'Gear assemblies' when 'HYD' then 'Hydraulic valves'
        when 'MOT' then 'Motor housings' when 'CTL' then 'Control panels'
        when 'SHA' then 'Precision shafts' when 'CAS' then 'Castings'
        when 'BRG' then 'Bearings' when 'ELE' then 'Electronics'
        when 'STL' then 'Steel bar & plate' when 'SEA' then 'Seals & gaskets'
        when 'FAS' then 'Fasteners' end as family,
    case mtart when 'FERT' then 'Finished good' else 'Component' end as material_type,
    nullif(werks, '') as plant_code
from {{ source('bronze', 'erp_materials') }}
