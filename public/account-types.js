// Shared by the Worker and manual form. No classification is inferred from account names.
const entry = (id, label, base, subtype, group, egg = false) => ({ id, label, base, subtype, group, egg, kind: ['credit', 'loan', 'other_liability'].includes(base) ? 'debt' : 'asset' });
export const ACCOUNT_TYPES = [
    entry('checking', 'Checking', 'depository', 'checking', 'cash'),
    entry('savings', 'Savings', 'depository', 'savings', 'cash'),
    entry('cash_management', 'Cash management / money market deposit', 'depository', 'money market', 'cash'),
    entry('taxable_brokerage', 'Taxable brokerage', 'investment', 'brokerage', 'brokerage'),
    entry('traditional_ira', 'Traditional IRA', 'investment', 'ira', 'retirement', true),
    entry('roth_ira', 'Roth IRA', 'investment', 'roth', 'retirement', true),
    entry('rollover_ira', 'Rollover IRA', 'investment', 'rollover ira', 'retirement', true),
    entry('401k', '401(k)', 'investment', '401k', 'retirement', true),
    entry('roth_401k', 'Roth 401(k)', 'investment', 'roth 401k', 'retirement', true),
    entry('403b', '403(b)', 'investment', '403b', 'retirement', true),
    entry('457b', '457(b)', 'investment', '457b', 'retirement', true),
    entry('sep_ira', 'SEP IRA', 'investment', 'sep ira', 'retirement', true),
    entry('simple_ira', 'SIMPLE IRA', 'investment', 'simple ira', 'retirement', true),
    entry('pension', 'Pension', 'investment', 'pension', 'retirement', true),
    entry('hsa', 'HSA', 'investment', 'hsa', 'health', true),
    entry('529', '529 education savings', 'investment', '529', 'education'),
    entry('530a', 'Trump Account (530A)', 'investment', '530a', 'education'),
    entry('custodial', 'Custodial brokerage (UGMA/UTMA)', 'investment', 'ugma', 'custodial'),
    entry('other_investment', 'Other investment / unclassified', 'investment', null, 'other'),
    entry('credit_card', 'Credit card', 'credit', 'credit card', 'debts'),
    entry('mortgage', 'Mortgage', 'loan', 'mortgage', 'debts'),
    entry('other_loan', 'Other loan', 'loan', null, 'debts'),
    entry('other_asset', 'Other asset', 'other_asset', null, 'other'),
    entry('other_liability', 'Other liability', 'other_liability', null, 'debts'),
];
export const ACCOUNT_GROUPS = { cash: 'Checking & savings', retirement: 'Retirement', brokerage: 'Taxable brokerage', education: 'Education & children’s accounts', health: 'Health savings (HSA)', custodial: 'Custodial brokerage', other: 'Other / unclassified', debts: 'Debts' };
export function accountType(account) {
    const explicit = ACCOUNT_TYPES.find(t => t.id === account.detailed_type);
    if (explicit)
        return explicit;
    const subtype = (account.subtype || '').toLowerCase();
    const aliases = { 'utma': 'ugma', '401a': '401k', 'sarsep': 'sep ira', 'profit sharing plan': 'pension', 'keogh': 'pension' };
    return ACCOUNT_TYPES.find(t => t.subtype && t.subtype === (aliases[subtype] || subtype)) || ACCOUNT_TYPES.find(t => t.id === ({ investment: 'other_investment', credit: 'credit_card', loan: 'other_loan', depository: 'cash_management', other_liability: 'other_liability' }[account.type] || 'other_asset'));
}
