function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing ${name} — copy e2e/.env.example to e2e/.env and fill it in.`);
  }
  return v;
}

// The pre-seeded account (see e2e/README.md). Login/feed/profile tests use it;
// only signup tests create users.
export const CREDS = {
  email: required('E2E_EMAIL'),
  password: required('E2E_PASSWORD'),
  username: process.env.E2E_USERNAME || 'scene_e2e',
};

// Unique per call: signup tests never collide across runs or projects.
// Accumulating e2e+* users on the target DB is a documented known issue.
export function uniqueUser(tag: string) {
  const id = `${tag}${Date.now().toString(36)}`;
  return {
    email: `e2e+${id}@e2e.test`,
    username: `e2e_${id}`,
    password: 'e2e-Pass-12345',
  };
}
