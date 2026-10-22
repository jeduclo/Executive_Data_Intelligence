-- Order header + item, typed. Missing header currency is imputed from the
-- selling company's currency (data defect present in ~1% of ERP headers).
with h as (
    select
        vbeln as order_id,
        {{ odata_date('erdat') }} as order_date,
        kunnr,
        vkorg as company_code,
        werks as plant_code,
        nullif(waerk, '') as header_currency,
        {{ odata_date('vdatu') }} as requested_date
    from {{ source('bronze', 'erp_sales_order_headers') }}
),
i as (
    select
        vbeln as order_id,
        cast(posnr as integer) as line_no,
        matnr as material_id,
        cast(kwmeng as double) as qty_ordered,
        cast(netpr as double) as unit_price_local,
        cast(netwr as double) as net_value_local,
        waerk as item_currency,
        {{ odata_date('edatu') }} as promised_date
    from {{ source('bronze', 'erp_sales_order_items') }}
)
select
    i.order_id,
    i.line_no,
    h.order_date,
    h.requested_date,
    i.promised_date,
    s.site_id,
    c.customer_id,
    h.kunnr as source_customer_number,
    i.material_id,
    i.qty_ordered,
    i.unit_price_local,
    i.net_value_local,
    coalesce(h.header_currency, s.currency) as currency,
    h.header_currency is null as currency_imputed
from i
join h using (order_id)
join {{ ref('sites') }} s on s.plant_code = h.plant_code
left join {{ ref('slv_customers') }} c on c.kunnr = h.kunnr
