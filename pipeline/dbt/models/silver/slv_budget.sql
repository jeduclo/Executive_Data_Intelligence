-- Finance budget arrives as an Excel export: "Apr-26" months and "1,234,000" numbers
select
    s.site_id,
    b.fy as fiscal_year,
    cast(strptime(b.month, '%b-%y') as date) as month_start,
    b.currency,
    {{ excel_number('"revenue_budget"') }} as revenue_budget_local,
    {{ excel_number('"gross_margin_budget"') }} as margin_budget_local
from {{ source('bronze', 'finance_budget') }} b
join {{ ref('sites') }} s on s.plant_code = b.plant
