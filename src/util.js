'use strict';

/**
 * Age in whole years. Prefers date_of_birth (never shown publicly, PS-2/3.1);
 * falls back to the manually entered age_years.
 */
function ageOf(profile) {
  if (profile.date_of_birth) {
    const dob = new Date(profile.date_of_birth + 'T00:00:00');
    if (!Number.isNaN(dob.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const beforeBirthday =
        now.getMonth() < dob.getMonth() ||
        (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
      if (beforeBirthday) age -= 1;
      return age;
    }
  }
  return profile.age_years ?? null;
}

const INCOME_RANGES = [
  'Below $50 / month',
  '$50 – $100 / month',
  '$100 – $200 / month',
  '$200 – $400 / month',
  'Above $400 / month',
  'No steady income',
];

module.exports = { ageOf, INCOME_RANGES };
