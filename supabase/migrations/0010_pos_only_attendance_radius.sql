-- Attendance radius is controlled by a signed DEN POS admin action only.
revoke all on function set_attendance_radius(uuid, integer) from public, anon, authenticated;