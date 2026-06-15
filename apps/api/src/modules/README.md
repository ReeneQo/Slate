# modules/

Доменные feature-модули. Каждый модуль самодостаточен и держит свои слои:

```
<feature>/
├── <feature>.controller.ts   # транспорт, тонкий
├── <feature>.service.ts      # бизнес-логика, не знает про ORM
├── <feature>.repository.ts   # доступ к данным, единственный с Prisma
├── <feature>.module.ts
├── dto/
└── entities/
```

Зависимость строго в одну сторону: `controller → service → repository`.
