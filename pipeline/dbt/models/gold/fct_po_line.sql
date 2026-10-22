-- Grain: one purchase-order line
select
    po.po_id,
    po.po_line,
    po.site_id,
    po.supplier_id,
    sup.supplier_name,
    sup.category as supplier_category,
    sup.is_critical as supplier_is_critical,
    po.material_id,
    po.order_date,
    po.due_date,
    po.receipt_date,
    po.qty,
    round(po.value_local / fx.rate_per_gbp, 2) as value_gbp,
    case when po.receipt_date is not null then 'Received' else 'Open' end as status,
    po.due_date <= {{ as_of() }} as is_due,
    case when po.receipt_date is not null then po.receipt_date <= po.due_date
         when po.due_date < {{ as_of() }} then false end as on_time,
    case when po.receipt_date is not null then greatest(po.receipt_date - po.due_date, 0)
         when po.due_date < {{ as_of() }} then {{ as_of() }} - po.due_date else 0 end as days_late
from {{ ref('slv_purchase_orders') }} po
left join {{ ref('slv_suppliers') }} sup using (supplier_id)
left join {{ ref('slv_fx_rates') }} fx on fx.rate_date = po.order_date and fx.currency = po.currency
