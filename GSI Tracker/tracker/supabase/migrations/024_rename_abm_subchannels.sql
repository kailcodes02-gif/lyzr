-- Rename the two ABM sub-channels in the GSI vertical (per Kailash 2026-09-26).
UPDATE channels SET name = 'ABM SI'  WHERE name = '12.1 SI (> $500M ARR)';
UPDATE channels SET name = 'ABM GSI' WHERE name = '12.2 GSI';
SELECT name, slug FROM channels WHERE name IN ('ABM SI', 'ABM GSI');
