const { GraphQLError } = require('graphql');

const ROLE_OWNER = 'owner';
const ROLE_CASHIER = 'cashier';
const ROLE_CHEF = 'chef';
const ROLE_INVENTORY = 'inventory';

const PERMISSIONS = {
  [ROLE_OWNER]: {
    'sale.create': true,
    'sale.read_all': true,
    'sale.read_own': true,
    'sale.edit': true,
    'order.create': true,
    'order.read_all': true,
    'order.read_kitchen': true,
    'order.edit': true,
    'order.advance_status': true,
    'order.collect': true,
    'order.cancel': true,
    // BR-05/D-28: quoting a custom cake. Owner only, and separate from
    // order.create on purpose: the person who describes the cake at the till is
    // not the person who decides what it costs.
    'order.quote': true,
    'usage.create': true,    'usage.read_all': true,
    // Confirming the real number is what moves stock, so it is kept separate
    // from usage.create (the chef's estimate) and from usage.read_all (viewing).
    'usage.verify': true,
    'stock.read': true,
    'stock.adjust_restock': true,
    'stock.adjust_waste': true,
    'product.manage': true,
    'product.read': true,
    'recipe.manage': true,
    // Overriding the matcher's choice of recipe. Owner only, and deliberately
    // separate from recipe.manage: the inventory clerk can write recipes, but
    // saying that a specific order is actually a different recipe is an owner's
    // call about what the shop promised the customer.
    'recipe.override': true,
    'category.manage': true,
    'ombi.tuma': true,
    'ombi.fungua': true,
    'ombi.anzisha': true,
    'ombi.kamilisha': true,
    'ombi.amua': true,
    'staff.manage': true,
    'customer.manage': true,
    'report.access_dashboard': true,
  },
  [ROLE_CASHIER]: {
    'sale.create': true,
    'sale.read_own': true,
    'order.create': true,
    'order.read_all': true,
    'order.collect': true,
    'stock.read': true,
    'product.read': true,
    'customer.manage': true,
    // Cashiers can ask the kitchen for something. Closing one is allowed here so
    // that a request actually addressed to this cashier is not something only
    // the owner can action — but the resolver still requires the caller to be
    // the recipient (or the owner), so this flag is a gate, not the control.
    'ombi.tuma': true,
    'ombi.fungua': true,
    'ombi.amua': true,
    'ombi.kamilisha': true,
  },
  [ROLE_CHEF]: {
    'order.read_kitchen': true,
    'order.advance_status': true,
    // The chef is the one handing the order over, so they close the ticket too.
    'order.collect': true,
    'usage.create': true,
    'stock.read': true,
    'ombi.tuma': true,
    // Same reasoning as the cashier: a chef told to "make a new product" is the
    // one who can say it's done. The resolver's recipient check does the real
    // work, so a chef still cannot close a request aimed at someone else.
    'ombi.fungua': true,
    // A chef is routinely the person a request is addressed to, so they have to
    // be able to pick it up, start it and call it done. None of these are the
    // control: the state machine allows a step only from the right state, and
    // moveOmbi still requires the caller to be the recipient or the owner. What
    // these flags do is keep the permission layer from rejecting an action the
    // kitchen is supposed to be allowed to take.
    'ombi.amua': true,
    'ombi.kamilisha': true,
    'ombi.anzisha': true,
  },
  [ROLE_INVENTORY]: {
    'usage.read_all': true,
    // Verifying usage is the inventory role's core job, so it belongs here.
    'usage.verify': true,
    'stock.read': true,
    'stock.adjust_restock': true,
    'stock.adjust_waste': true,
    'recipe.manage': true,
    'category.manage': true,
    'ombi.tuma': true,
    'ombi.fungua': true,
    'ombi.amua': true,
    'ombi.kamilisha': true,
  },
};

function can(user, permission) {
  if (!user) return false;
  return Boolean(PERMISSIONS[user.jukumu] && PERMISSIONS[user.jukumu][permission]);
}

function requireCan(user, permission, message = 'Hamna ruhusa ya kufanya hili.') {
  requireAuthenticated(user);
  if (!can(user, permission)) {
    throw new GraphQLError(message, {
      extensions: { code: 'FORBIDDEN', role: user.jukumu, permission },
    });
  }
  return true;
}

/**
 * Assert only that a caller is logged in, without demanding a specific
 * permission. Use this before a hand-written `can(...) || can(...)` check so
 * an anonymous caller still gets UNAUTHENTICATED rather than being told
 * "forbidden" for a resource they could never see anyway.
 *
 * Note: never chain requireCan with `||` — it throws rather than returning
 * false, so the second call is unreachable and any `if` after it is dead code.
 */
function requireAuthenticated(user) {
  if (!user) {
    throw new GraphQLError('Lazima uingie. (Unauthorized)', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  return true;
}

module.exports = {
  ROLE_OWNER,
  ROLE_CASHIER,
  ROLE_CHEF,
  ROLE_INVENTORY,
  can,
  requireCan,
  requireAuthenticated,
};