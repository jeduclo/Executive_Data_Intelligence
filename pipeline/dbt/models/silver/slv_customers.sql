-- Customer master with duplicates resolved: records that normalise to the same
-- name + country are merged onto the oldest customer number (golden record).
with src as (
    select
        kunnr,
        trim(regexp_replace(name1, '\s+', ' ', 'g')) as raw_name,
        land1 as country,
        vkorg as company_code,
        ktokd as segment_code,
        zzkeyacc = 'X' as is_key_account
    from {{ source('bronze', 'erp_customers') }}
),
norm as (
    select *, lower(regexp_replace(raw_name, '\.$', '')) as match_key from src
),
golden as (
    select match_key, country, min(kunnr) as customer_id
    from norm group by 1, 2
)
select
    n.kunnr,
    g.customer_id,
    n.kunnr <> g.customer_id as is_duplicate,
    n.country,
    n.company_code,
    case n.segment_code when 'OEM' then 'OEM' when 'DIST' then 'Distributor' else 'Aftermarket' end as segment,
    n.is_key_account,
    n.raw_name
from norm n
join golden g using (match_key, country)
