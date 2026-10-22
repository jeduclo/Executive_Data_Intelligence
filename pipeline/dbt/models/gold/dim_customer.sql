-- One row per golden customer
select
    customer_id,
    any_value(raw_name) filter (where not is_duplicate) as customer_name,
    any_value(country) as country,
    any_value(segment) as segment,
    bool_or(is_key_account) as is_key_account,
    count(*) - 1 as merged_duplicates
from {{ ref('slv_customers') }}
group by customer_id
