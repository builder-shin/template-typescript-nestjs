import { Injectable, RequestMethod } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';

function paths(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

/** Read already registered controllers; this never discovers or registers new routes. */
@Injectable()
export class RouteMethods implements OnModuleInit {
  private readonly routes: { pattern: RegExp; method: string }[] = [];

  constructor(private readonly modules: ModulesContainer) {}

  onModuleInit(): void {
    const scanner = new MetadataScanner();
    for (const module of this.modules.values()) {
      for (const wrapper of module.controllers.values()) {
        const instance: unknown = wrapper.instance;
        const controller = wrapper.metatype;
        if (typeof instance !== 'object' || instance === null || !controller) continue;
        const prefixes = paths(Reflect.getMetadata(PATH_METADATA, controller));
        const prototype: unknown = Object.getPrototypeOf(instance);
        if (typeof prototype !== 'object' || prototype === null) continue;
        for (const name of scanner.getAllMethodNames(prototype)) {
          const handler: unknown = Reflect.get(instance, name);
          if (typeof handler !== 'function') continue;
          const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
          if (typeof method !== 'number') continue;
          const methodName = RequestMethod[method];
          if (methodName === undefined) continue;
          for (const prefix of prefixes) {
            for (const suffix of paths(Reflect.getMetadata(PATH_METADATA, handler))) {
              const segments = (prefix + '/' + suffix).split('/').filter(Boolean);
              const pattern = segments
                .map((segment) =>
                  segment.startsWith(':')
                    ? '[^/]+'
                    : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                )
                .join('/');
              this.routes.push({ pattern: new RegExp('^/' + pattern + '/?$'), method: methodName });
            }
          }
        }
      }
    }
  }

  allowed(url: string): string[] {
    const path = url.split('?')[0] ?? url;
    return [
      ...new Set(
        this.routes.filter((route) => route.pattern.test(path)).map((route) => route.method),
      ),
    ].sort();
  }
}
