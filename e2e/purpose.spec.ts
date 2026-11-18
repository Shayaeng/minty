import {expect,test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

// Only the isolated LOCAL test database. No test endpoint or remote D1 access is introduced.
function localSql(sql:string){
  execFileSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB','--local','--persist-to','.wrangler/household-e2e','--command',sql],{stdio:'pipe'});
}
test('Personal and Churning remain separate through classification, real navigation, bonus details, edits and moves',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('minty_lock',JSON.stringify({state:'off'})));
  await page.addInitScript(()=>{
    new MutationObserver(()=>{
      if(document.documentElement.dataset.purpose==='churning'&&document.documentElement.dataset.purposeChanging!=='true'&&document.getElementById('feed')?.textContent?.includes('Personal purchase E2E'))sessionStorage.setItem('purpose_wrong_view_flash','true');
    }).observe(document,{childList:true,subtree:true,characterData:true});
  });
  const personName='Purpose test person '+Date.now();
  const own=await(await request.post('/people',{data:{label:personName}})).json();
  const cleanup="DELETE FROM items WHERE id=900001; DELETE FROM items WHERE plaid_item_id LIKE 'manual:%' AND id IN (SELECT item_id FROM accounts WHERE name='Purpose inventory E2E');";
  localSql(cleanup+`
    INSERT INTO items(id,owner,plaid_account,plaid_item_id,access_token_enc,institution_name,status) VALUES(900001,'${own.id}','me_primary','purpose-e2e-citi','','Citi','good');
    INSERT INTO accounts(id,owner,item_id,plaid_account_id,name,type,subtype,mask,balance_current_cents,currency) VALUES
      (900001,'${own.id}',900001,'purpose-e2e-personal','Citi daily E2E','credit','credit card','1234',10000,'USD'),
      (900002,'${own.id}',900001,'purpose-e2e-churn-card','Citi bonus E2E','credit','credit card','5678',25000,'USD'),
      (900003,'${own.id}',900001,'purpose-e2e-churn-checking','Citi checking E2E','depository','checking','9012',200000,'USD');
    INSERT INTO transactions(owner,account_id,plaid_txn_id,amount_cents,currency,date,name,category) VALUES
      ('${own.id}',900001,'purpose-e2e-txn-personal',111,'USD','2026-11-01','Personal purchase E2E','GENERAL_MERCHANDISE'),
      ('${own.id}',900002,'purpose-e2e-txn-churn',222,'USD','2026-11-02','Churning purchase E2E','GENERAL_MERCHANDISE');
  `);
  try{
    await page.goto('/account-overview');
    const purpose=page.getByRole('navigation',{name:'Financial purpose'});
    await expect(purpose.getByRole('button',{name:'Personal',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#accountList')).not.toContainText('Citi daily E2E');
    await page.getByRole('link',{name:/Finish account setup/}).click();
    await page.goto('/account-classification?item_id=900001');
    await expect(page.locator('[data-account-id="900001"]')).toHaveValue('');
    await expect(page.locator('#classificationAccounts')).toContainText('Last four 5678');
    await page.reload(); // Interrupted setup must not classify anything automatically.
    await expect(page.locator('[data-account-id="900001"]')).toHaveValue('');
    await page.getByRole('button',{name:'Set listed accounts to Churning',exact:true}).click();
    await page.locator('[data-account-id="900001"]').selectOption('personal');
    await page.getByRole('button',{name:'Save classifications',exact:true}).click();
    await expect(page.locator('#classificationStatus')).toContainText('Classifications saved');
    await page.getByRole('link',{name:'Back to Accounts',exact:true}).click();
    await page.locator('#people').getByRole('button',{name:personName,exact:true}).click();
    await expect(page.locator('#accountList .account-card')).toHaveCount(1);
    await expect(page.locator('#accountList')).toContainText('Citi daily E2E');
    await expect(page.locator('#totals')).toContainText('$100.00');
    await page.getByRole('link',{name:'Transactions',exact:true}).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#feed')).toContainText('Personal purchase E2E');
    await expect(page.locator('#feed')).not.toContainText('Churning purchase E2E');
    await page.locator('#ownerSeg').getByRole('button',{name:personName,exact:true}).click();
    await purpose.getByRole('button',{name:'Churning',exact:true}).click();
    await expect(purpose.getByRole('button',{name:'Churning',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#ownerSeg').getByRole('button',{name:personName,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#feed')).toContainText('Churning purchase E2E');
    await expect(page.locator('#feed')).not.toContainText('Personal purchase E2E');
    expect(await page.evaluate(()=>sessionStorage.getItem('purpose_wrong_view_flash'))).toBeNull();
    await page.getByRole('link',{name:'Accounts',exact:true}).click();
    await expect(page).toHaveURL(/\/account-overview$/);
    await expect(page.locator('#people').getByRole('button',{name:personName,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#accountList .account-card')).toHaveCount(2);
    await expect(page.locator('#totals')).toContainText('$1,750.00');
    await page.getByRole('button',{name:'Bonus tracker',exact:true}).click();
    await expect(page.locator('#bonusList')).not.toContainText('Citi daily E2E');
    await page.getByRole('link',{name:'Add manual account',exact:true}).click();
    await expect(page.locator('#purpose')).toHaveValue('churning');
    await page.locator('#owner').selectOption(own.id);await page.locator('#name').fill('Purpose inventory E2E');
    await page.locator('#detailed_type').selectOption('checking');await page.locator('#inventory_only').check();
    await page.getByRole('button',{name:'Save account',exact:true}).click();
    await expect(page.locator('#status')).toContainText('Account saved');
    await page.getByRole('link',{name:'Back to Accounts',exact:true}).click();
    await expect(page.locator('#accountList')).toContainText('Purpose inventory E2E');
    await expect(page.locator('#accountList')).toContainText('Inventory only');
    const card=page.locator('.account-card').filter({has:page.getByRole('heading',{name:'Citi bonus E2E',exact:true})});
    page.once('dialog',dialog=>{expect(dialog.message()).toContain('entire transaction, balance and bonus history');dialog.accept();});
    await card.getByRole('button',{name:'Move to Personal',exact:true}).click();
    await expect(page.locator('#purposeNotice')).toContainText('Account moved to Personal');
    await expect(page.locator('#accountList')).not.toContainText('Citi bonus E2E');
    await purpose.getByRole('button',{name:'Personal',exact:true}).click();
    await expect(page.locator('#accountList')).toContainText('Citi bonus E2E');
    await expect(page.locator('#accountList')).not.toContainText('Citi checking E2E');
    await page.getByRole('link',{name:'Transactions',exact:true}).click();
    await expect(page.locator('#feed')).toContainText('Personal purchase E2E');
    await expect(page.locator('#feed')).toContainText('Churning purchase E2E'); // Its account and entire history moved.
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  }finally{localSql(cleanup);}
});

