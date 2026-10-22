select
    aubel as order_id,
    cast(aupos as integer) as line_no,
    vbeln_vf as billing_doc,
    cast(fkimg as double) as qty_invoiced,
    cast(netwr as double) as revenue_local,
    waerk as currency,
    {{ odata_date('fkdat') }} as invoice_date
from {{ source('bronze', 'erp_billing') }}
