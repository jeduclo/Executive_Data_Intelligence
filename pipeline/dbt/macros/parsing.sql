{# SAP OData v2 date "/Date(1793318400000)/" -> DATE (timezone-safe) #}
{% macro odata_date(col) -%}
    (date '1970-01-01' + cast(floor(cast(regexp_extract({{ col }}, '(-?\d+)', 1) as bigint) / 86400000) as integer))
{%- endmacro %}

{# MES exports: German plants send dd.mm.yyyy, others ISO yyyy-mm-dd #}
{% macro mixed_date(col) -%}
    cast(coalesce(try_strptime({{ col }}, '%d.%m.%Y'), try_strptime({{ col }}, '%Y-%m-%d')) as date)
{%- endmacro %}

{# Excel exports with thousands separators: "1,234,000" -> 1234000 #}
{% macro excel_number(col) -%}
    cast(replace(replace({{ col }}, ',', ''), ' ', '') as double)
{%- endmacro %}

{% macro as_of() -%}
    date '{{ var("as_of_date") }}'
{%- endmacro %}
