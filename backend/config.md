https://medium.com/@nairi.abgaryan/stop-the-chaos-clean-folder-file-naming-guide-for-backend-nest-js-and-node-331fdc6400cb
src/
├── common/
├── core/
│   ├── database/
│   │   ├── database.module.ts
│   │   ├── database.providers.ts
│   │   └── migrations/
│   └── config/
├── modules/
│   ├── users/
│   │   ├── entities/
│   │   │   └── user.entity.ts
│   │   ├── dto/
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   └── users.module.ts
│   │
│   ├── posts/
│   │   ├── entities/
│   │   │   └── post.entity.ts
│   │   ├── posts.controller.ts
│   │   ├── posts.service.ts
│   │   └── posts.module.ts
│
├── commands/
├── integrations/
├── events/
├── app.module.ts
└── main.ts
