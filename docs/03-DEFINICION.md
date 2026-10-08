# 03 — Definición

> Fase 3. Dueño: **Product Owner**. Convertir el problema en una spec
> **verificable**. Termina con el gate humano.

- **Proyecto:**
- **Fecha:**
- **Iteración:**

## Historias de usuario

### HU-1
**Como** <rol>
**quiero** <acción>
**para** <beneficio>

**Criterios de aceptación (EARS + clase):**

> Todo criterio se escribe en **notación EARS** y **declara su clase**. Un criterio
> de clase `forma` **sin medición no está definido** y G1 no pasa.

```
CUANDO  ⟨disparador⟩              EL SISTEMA DEBE ⟨comportamiento observable⟩
MIENTRAS ⟨estado⟩                 EL SISTEMA DEBE ⟨comportamiento observable⟩
SI ⟨condición no deseada⟩ ENTONCES EL SISTEMA DEBE ⟨respuesta⟩
```

| Clase | Verifica | Ejemplo de observable |
|---|---|---|
| `existencia` | que el elemento está | `document.querySelector('#wizard') !== null` |
| `comportamiento` | que hace lo que debe | al hacer clic avanza al paso 2 |
| `forma` | **cómo se ve / se dispone** | `getBoundingClientRect()`: los 3 pasos comparten `top` ±4px |

- **C-01** · clase `existencia`
  CUANDO el usuario abre la app EL SISTEMA DEBE mostrar el contenedor `#wizard`
- **C-02** · clase `comportamiento`
  CUANDO el usuario hace clic en "Siguiente" EL SISTEMA DEBE avanzar al paso 2
- **C-03** · clase `forma`
  MIENTRAS la app muestra los 3 pasos, EL SISTEMA DEBE disponerlos horizontales:
  los 3 comparten `top` (±4px) y el `left` es estrictamente creciente

### HU-2
…

## Etapas

> **Obligatorio si el diseño tiene complejidad combinada** (varios ejes que se
> multiplican: N variantes × M estados). El Arquitecto propone el corte en G2 y el
> PO lo documenta aquí. Si el proyecto es pequeño y de un solo eje, escribir
> "No aplica" y por qué.

**Etapa 1 (este ciclo) — valor visible rápido:**
- Qué entra: …
- Por qué esto prueba el mecanismo completo: …

**Diferido a la Etapa 2:**
- Qué queda fuera: …
- Por qué se puede diferir sin romper la Etapa 1: …

## Mockup (cierre de la fase 3)

> El **Arquitecto** construye un mockup de la pantalla o el flujo (estático, sin
> datos reales) y lo publica en una **URL**. El entregable **no es una aprobación**:
> son **criterios de clase `forma`** extraídos arriba. Una vez extraídos, el mockup
> **se congela** (es evidencia, no un contrato vivo). **No aplica** para un CLI, una
> librería o un pipeline → se declara con razón escrita.

- **URL del mockup:** (o "no aplica" + razón)
- **Criterios de clase `forma` extraídos:** C-… / "no generó ninguno" + por qué

## Casos borde y de error

| Caso | Comportamiento esperado |
|---|---|
| … | … |

## Definición de "terminado" para esta iteración

- [ ] …

## Fuera de esta iteración

- …

---

## Aprobación

- [ ] **Aprobado por el usuario** — fecha:
- [ ] Cambios solicitados:

---

**Gate G1 ⭐ (humano):** cada criterio está en EARS, declara su clase y se puede
convertir en un test; los de clase `forma` traen su medición. Sin aprobación
explícita del usuario, no se avanza a diseño.
