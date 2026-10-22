select material_id, description, family_code, family, material_type, plant_code
from {{ ref('slv_materials') }}
