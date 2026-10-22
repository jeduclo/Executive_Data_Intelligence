-- What silver fixed on the way from bronze. Surfaced on the portal's Data quality page.
select 'Duplicate customer records merged to golden record' as correction, 'ERP customers' as source,
       count(*) filter (where is_duplicate) as records_affected from {{ ref('slv_customers') }}
union all
select 'Order headers with missing currency imputed', 'ERP sales orders',
       count(distinct order_id) filter (where currency_imputed) from {{ ref('slv_sales_orders') }}
union all
select 'Duplicate material documents removed (interface retries)', 'ERP stock movements',
       (select count(*) from {{ source('bronze', 'erp_stock_movements') }}) - (select count(*) from {{ ref('slv_stock_movements') }})
union all
select 'Production orders with dd.mm.yyyy dates normalised', 'MES production orders',
       count(*) filter (where source_date_non_iso) from {{ ref('slv_production_orders') }}
union all
select 'Budget lines parsed from Excel formatting', 'Finance budget', count(*) from {{ ref('slv_budget') }}
