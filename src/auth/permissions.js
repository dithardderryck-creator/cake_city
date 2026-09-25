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
    'usage.create': true,
    'usage.read_all': true,
    'stock.read': true,
    'stock.adjust_restock': true,
    'stock.adjust_waste': true,
    'product.manage': true,
    'product.read': true,
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
  },
  [ROLE_CHEF]: {
    'order.read_kitchen': true,
    'order.advance_status': true,
    'usage.create': true,
    'stock.read': true,
  },
  [ROLE_INVENTORY]: {
    'usage.read_all': true,
    'stock.read': true,
    'stock.adjust_restock': true,
    'stock.adjust_waste': true,
  },
};

function can(user, permission) {
  if (!user) return false;
  return Boolean(PERMISSIONS[user.jukumu] && PERMISSIONS[user.jukumu][permission]);
}

function requireCan(user, permission, message = 'Hamna ruhusa ya kufanya hili.') {
  if (!user) {
    throw new GraphQLError('Lazima uingie. (Unauthorized)', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  if (!can(user, permission)) {
    throw new GraphQLError(message, {
      extensions: { code: 'FORBIDDEN', role: user.jukumu, permission },
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
};