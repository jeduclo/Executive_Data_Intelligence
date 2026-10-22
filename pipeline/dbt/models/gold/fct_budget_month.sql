select
    b.site_id,
    b.fiscal_year,
    b.month_start,
    round(b.revenue_budget_local / fx.rate_per_gbp, 2) as revenue_budget_gbp,
    round(b.margin_budget_local / fx.rate_per_gbp, 2) as margin_budget_gbp
from {{ ref('slv_budget') }} b
join {{ ref('budget_fx') }} fx on fx.fiscal_year = b.fiscal_year and fx.currency = b.currency
