import { serializeTimestamp } from '../jsonapi/exact-timestamps.js';
import type { ResourceSerializer } from './serializer.js';
import type { User } from '../models/user.entity.js';

export const USER_SERIALIZER: ResourceSerializer<User> = {
  type: 'users',
  selfLink: () => '/api/v1/users/me',
  attributes: {
    email: (user) => user.email,
    isActive: (user) => user.isActive,
    createdAt: (user) => serializeTimestamp(user.createdAt),
    updatedAt: (user) => serializeTimestamp(user.updatedAt),
  },
  relationships: {},
};
