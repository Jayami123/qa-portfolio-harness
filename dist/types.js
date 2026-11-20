export const P4_PRODUCT_IDS = [
    "nextcloud",
    "outline",
    "penpot",
    "mattermost",
    "litellm",
    "librechat",
    "openclaw",
];
export function isForkProductId(id) {
    return !P4_PRODUCT_IDS.includes(id);
}
//# sourceMappingURL=types.js.map