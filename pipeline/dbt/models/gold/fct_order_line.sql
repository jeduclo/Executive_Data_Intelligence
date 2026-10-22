-- Grain: one sales order line. The single source for revenue, margin, OTIF and backlog.
with o as (select * from {{ ref('slv_sales_orders') }}),
d as (
    select order_id, line_no, max(ship_date) as ship_date, sum(qty_shipped) as qty_shipped
    from {{ ref('slv_deliveries') }} group by 1, 2
),
b as (
    select order_id, line_no, max(invoice_date) as invoice_date,
           sum(qty_invoiced) as qty_invoiced, sum(revenue_local) as revenue_local
    from {{ ref('slv_billing') }} group by 1, 2
),
base as (
    select
        o.*, s.plant_code, m.family, m.family_code,
        d.ship_date, d.qty_shipped, b.invoice_date, b.qty_invoiced, b.revenue_local
    from o
    join {{ ref('sites') }} s using (site_id)
    left join {{ ref('slv_materials') }} m using (material_id)
    left join d using (order_id, line_no)
    left join b using (order_id, line_no)
)
select
    base.order_id,
    base.line_no,
    base.site_id,
    base.customer_id,
    base.material_id,
    base.family,
    base.family_code,
    base.order_date,
    base.requested_date,
    base.promised_date,
    base.ship_date,
    base.invoice_date,
    base.qty_ordered,
    coalesce(base.qty_shipped, 0) as qty_shipped,
    case when base.invoice_date is not null then 'Invoiced'
         when base.ship_date is not null then 'Shipped' else 'Open' end as status,
    base.ship_date is null and base.promised_date < {{ as_of() }} as is_overdue,
    base.promised_date <= {{ as_of() }} as is_due,
    case when base.ship_date is not null then greatest(base.ship_date - base.promised_date, 0)
         when base.promised_date < {{ as_of() }} then {{ as_of() }} - base.promised_date
         else 0 end as days_late,
    case when base.ship_date is not null then base.ship_date <= base.promised_date
         when base.promised_date < {{ as_of() }} then false end as on_time,
    case when base.ship_date is not null then base.qty_shipped >= base.qty_ordered end as in_full,
    case when base.ship_date is not null then base.ship_date <= base.promised_date and base.qty_shipped >= base.qty_ordered
         when base.promised_date < {{ as_of() }} then false end as otif,
    base.currency,
    -- value columns below are protected by column-level security
    base.unit_price_local,
    base.net_value_local,
    round(base.net_value_local / fo.rate_per_gbp, 2) as order_value_gbp,
    case when base.ship_date is null then round(base.net_value_local / fo.rate_per_gbp, 2) else 0 end as open_value_gbp,
    round(base.revenue_local / fi.rate_per_gbp, 2) as revenue_gbp,
    round(base.qty_invoiced * c.std_cost_local / fi.rate_per_gbp, 2) as cost_gbp,
    round((base.revenue_local - base.qty_invoiced * c.std_cost_local) / fi.rate_per_gbp, 2) as margin_gbp
from base
left join {{ ref('slv_fx_rates') }} fo on fo.rate_date = base.order_date and fo.currency = base.currency
left join {{ ref('slv_fx_rates') }} fi on fi.rate_date = base.invoice_date and fi.currency = base.currency
left join {{ ref('slv_cost_standards') }} c
    on c.material_id = base.material_id and c.plant_code = base.plant_code
   and base.invoice_date between c.valid_from and c.valid_to
