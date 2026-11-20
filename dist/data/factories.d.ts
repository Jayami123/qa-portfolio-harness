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
export declare function setFactorySeed(seed: number): void;
export declare function fakeEmail(domain?: string): string;
export declare function fakePerson(): FakePerson;
export declare function fakeOrg(): FakeOrg;
//# sourceMappingURL=factories.d.ts.map