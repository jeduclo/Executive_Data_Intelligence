-- Daily FX, local currency per 1 GBP, one row per date x currency (GBP included)
with r as (
    select distinct cast("date" as date) as rate_date, rates__eur as eur, rates__usd as usd
    from {{ source('bronze', 'fx_daily_rates') }}
)
select rate_date, 'EUR' as currency, eur as rate_per_gbp from r
union all select rate_date, 'USD', usd from r
union all select rate_date, 'GBP', 1.0 from r
