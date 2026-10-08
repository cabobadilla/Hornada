# ADR-002 — Almacenamiento: D1 con UPDATE condicional

- **Fecha:** 2026-10-08
- **Estado:** aceptado
- **Decisor:** Arquitecto (Hornada, ciclo 1)

## Contexto

El requisito duro del ciclo 1 no es guardar: es **no permitir sobreventa** (C-15,
C-16, riesgo R4). Dos vecinos pueden tocar "Reservar" sobre la última docena en el
mismo segundo, y el sistema tiene que dejar ganar a uno solo.

Eso convierte el cupo en una **resta atómica**, no en un campo que se lee y se
reescribe. Es la única pieza del diseño donde la corrección no admite aproximaciones:
prometer pan que no se horneó es lo que el usuario declaró como fracaso (P3).

## Decisión

**Cloudflare D1 (SQLite)** con una única sentencia condicional:

```sql
UPDATE hornadas SET disponibles = disponibles - ?2, ...
 WHERE id = ?1 AND estado = 'abierta' AND disponibles >= ?2;
```

Si `meta.changes === 1` la reserva se acepta; si no, `409 sin_cupo`. **La base
decide**, no el Worker.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **KV** | Es un almacén de clave-valor **sin transacciones ni compare-and-set**. Habría que leer, comparar y escribir: exactamente la ventana de carrera que este ADR existe para cerrar |
| **Leer y después escribir** el cupo desde el Worker (con KV o con D1) | El mismo problema con otro nombre. Entre el `SELECT` y el `UPDATE` cabe otra reserva |
| **Durable Objects** | Sería **la** respuesta canónica a un contador con exclusión mutua, pero un DO por hornada obliga a pensar en ciclo de vida, hibernación y costo desde el ciclo 1. El plan Free de D1 ya da la atomicidad que hace falta, con menos piezas |
| **Guardar el cupo en el cliente** (localStorage / JSON estático) | Cada vecino vería su propia copia: dos reservarían la misma docena y la app mentiría. Es la razón por la que el producto no puede ser estático (ver ADR-003) |
| **Un contador en memoria del Worker** | El runtime es efímero y distribuido en el borde: la memoria no se comparte entre instancias ni sobrevive |
| Calcular `disponibles` como `unidades − SUM(reservas)` en cada lectura | Correcto en el fondo, pero convierte **cada lectura del listado en un agregado** y sigue necesitando serializar la escritura de la reserva. Más costoso para el mismo resultado |

## Consecuencias

**Positivas:**
- Una sola sentencia atómica resuelve la sobreventa; el test de concurrencia (H-1)
  puede fallar **solo** si el diseño está mal, no por una carrera del lenguaje.
- D1 es gratis en el rango que este producto necesita (< 100.000 escrituras/día) y
  viene con migraciones versionadas y una base **local** para la suite.
- Consultar el promedio de reseñas es un `AVG()` en SQL, sin job de mantenimiento.

**Negativas / costo asumido:**
- D1 tiene cuota diaria de escrituras y de filas leídas; el listado se limita a 50
  filas por request para no acercarse al techo de CPU.
- Un rollback de código **no** revierte el esquema → regla: migraciones **aditivas**,
  nunca `DROP` en el ciclo.

**Qué se vuelve difícil después de esto:**
- Si el producto crece a muchas ciudades con alta concurrencia por cocinero, la
  conversación vuelve sobre Durable Objects. El contrato de la API no cambia: solo el
  motor por debajo.
