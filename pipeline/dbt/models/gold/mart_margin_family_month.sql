-- Grain: site x product family x month. Feeds "where is margin leaking?"
select
    site_id,
    family,
    cast(date_trunc('month', invoice_date) as date) as month_start,
    sum(revenue_gbp) as revenue_gbp,
    sum(cost_gbp) as cogs_gbp,
    sum(margin_gbp) as margin_gbp
from {{ ref('fct_order_line') }}
where invoice_date <= {{ as_of() }} and invoice_date >= date '2025-04-01'
group by 1, 2, 3
