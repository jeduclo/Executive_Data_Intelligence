select
    vgbel as order_id,
    cast(vgpos as integer) as line_no,
    vbeln_vl as delivery_id,
    cast(lfimg as double) as qty_shipped,
    {{ odata_date('wadat_ist') }} as ship_date
from {{ source('bronze', 'erp_deliveries') }}
