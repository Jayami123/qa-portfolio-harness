import { faker } from "@faker-js/faker";

export interface FakePerson {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
}

export interface FakeOrg {
  name: string;
  slug: string;
}

/** Seed faker so generated data is deterministic across runs. */
export function setFactorySeed(seed: number): void {
  faker.seed(seed);
}

export function fakeEmail(domain = "qa.local"): string {
  return faker.internet.email({ provider: domain }).toLowerCase();
}

export function fakePerson(): FakePerson {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    email: faker.internet.email({ firstName, lastName, provider: "qa.local" }).toLowerCase(),
  };
}

export function fakeOrg(): FakeOrg {
  const name = faker.company.name();
  const slug = faker.helpers
    .slugify(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
  return {
    name,
    slug: slug || `org-${faker.string.alphanumeric(6).toLowerCase()}`,
  };
}
