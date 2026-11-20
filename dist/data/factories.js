import { faker } from "@faker-js/faker";
/** Seed faker so generated data is deterministic across runs. */
export function setFactorySeed(seed) {
    faker.seed(seed);
}
export function fakeEmail(domain = "qa.local") {
    return faker.internet.email({ provider: domain }).toLowerCase();
}
export function fakePerson() {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    return {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        email: faker.internet.email({ firstName, lastName, provider: "qa.local" }).toLowerCase(),
    };
}
export function fakeOrg() {
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
//# sourceMappingURL=factories.js.map