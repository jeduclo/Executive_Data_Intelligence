with po as (
    select
        ebeln as po_id,
        cast(ebelp as integer) as po_line,
        lifnr as supplier_id,
        werks as plant_code,
        matnr as material_id,
        cast(menge as double) as qty,
        cast(netwr as double) as value_local,
        waers as currency,
        {{ odata_date('bedat') }} as order_date,
        {{ odata_date('eindt') }} as due_date
    from {{ source('bronze', 'erp_purchase_order_items') }}
),
gr as (
    select ebeln as po_id, cast(ebelp as integer) as po_line, min({{ odata_date('budat') }}) as receipt_date
    from {{ source('bronze', 'erp_po_receipts') }}
    group by 1, 2
)
select po.*, s.site_id, gr.receipt_date
from po
join {{ ref('sites') }} s on s.plant_code = po.plant_code
left join gr using (po_id, po_line)
