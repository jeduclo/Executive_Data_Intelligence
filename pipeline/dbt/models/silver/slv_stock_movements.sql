-- Material documents, de-duplicated (interface retries create exact duplicates)
-- and signed (SHKZG S = receipt, H = issue).
select
    mblnr as document_id,
    zeile as document_line,
    {{ odata_date('budat') }} as posting_date,
    bwart as movement_type,
    matnr as material_id,
    s.site_id,
    case shkzg when 'H' then -1 else 1 end * cast(menge as double) as qty
from {{ source('bronze', 'erp_stock_movements') }} m
join {{ ref('sites') }} s on s.plant_code = m.werks
qualify row_number() over (partition by mblnr, zeile order by _dlt_load_id desc) = 1
