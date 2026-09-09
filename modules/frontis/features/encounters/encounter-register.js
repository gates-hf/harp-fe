// Register a patient without leaving the encounter flow: the registration
// screen itself, mounted in the shared drawer. One form, two doors — so the
// duplicate check, the identifier rules and the photo all come with it, and
// there is no second registration form to keep in step.
//
// patient-form.js is a route screen, so it is handed the ctx the shell would
// hand it. Its one exit is ctx.navigate() to the record it just wrote, which is
// where the new MRN comes from.

import * as drawer from '../../../../shared/drawer.js';

/** Resolves with the new MRN, or '' when the sheet was closed without saving. */
export async function openRegisterDrawer() {
  const sheet = drawer.open({
    title: 'Register patient',
    sub: 'The duplicate check runs before the MRN is spent',
    icon: 'person_add',
    body: '<div id="en-register"></div>',
    foot: '<button class="btn btn--secondary" data-close>Cancel</button>',
  });

  const mount = sheet.el.querySelector('#en-register');
  const form = await import('../patient-master/patient-form.js');
  await form.render(mount, ctxFor(sheet));

  // The form's own Cancel is a link back to Patient Master, which would take
  // the page out from under the flow. The sheet has a Cancel, an X and Escape,
  // so the link is dropped from this copy rather than pointed somewhere else.
  mount.querySelector('#pf-cancel')?.remove();

  const answer = await sheet.closed;
  return typeof answer === 'string' && answer.startsWith('MRN-') ? answer : '';
}

function ctxFor(sheet) {
  return {
    params: [],
    query: {},
    route: {},
    module: null,
    actions: document.createElement('div'),
    setHeader() {},
    setCrumb() {},
    href: (path) => `#${path}`,
    onData() {},
    navigate(path) {
      // The form navigates to the record it wrote. In a sheet that is not a
      // route change — it is the answer.
      sheet.close(String(path).split('/').pop());
    },
  };
}
