# Backend - Sistema de Sueldos

## 📋 Descripción

Se ha implementado el sistema completo de gestión de pagos de sueldos a profesores en el backend.

## 📁 Archivos Agregados

### Rutas
- **`src/routes/admin/sueldos.js`** (175 líneas)
  - Implementa 4 endpoints REST
  - Cálculo automático de sueldos
  - Registro de pagos con integración a movimientos

### Scripts
- **`scripts/setup_sueldos.sql`** - Script SQL manual (opcional)
- **`scripts/init_sueldos.js`** - Script de inicialización automática

## 🔧 Instalación

### Opción 1: Automática (Recomendada)

El sistema se inicializa automáticamente al arrancar la API. La primera vez que se ejecute:

```bash
npm start
```

La aplicación automáticamente:
1. ✅ Crea la tabla `sueldos_pagados`
2. ✅ Crea índices necesarios
3. ✅ Agrega columna `porcentaje_p` a profesores (si no existe)
4. ✅ Crea categoría "Sueldo" en movimientos (si no existe)
5. ✅ Crea triggers de auditoría

### Opción 2: Manual

Si prefieres ejecutar el SQL manualmente:

```bash
# En PostgreSQL
psql -U usuario -d mortagym -f scripts/setup_sueldos.sql
```

### Opción 3: Script independiente

```bash
node scripts/init_sueldos.js
```

## 📊 Endpoints Implementados

### 1. GET `/api/admin/sueldos?mes=YYYY-MM`

**Calcula sueldos del mes especificado**

**Parámetros:**
- `mes` (query): Mes en formato YYYY-MM (ej: "2025-01")

**Ejemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:3000/api/admin/sueldos?mes=2025-01"
```

**Respuesta:**
```json
[
  {
    "profesor_id": 1,
    "profesor_nombre": "Juan Pérez",
    "porcentaje": 20,
    "clientes_pagos": 15,
    "monto": 7500.50,
    "estado": "Pendiente"
  }
]
```

---

### 2. GET `/api/admin/sueldos/historial`

**Obtiene historial de todos los pagos realizados**

**Ejemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:3000/api/admin/sueldos/historial"
```

**Respuesta:**
```json
[
  {
    "id_sueldo": 1,
    "id_profesor": 1,
    "profesor_nombre": "Juan Pérez",
    "mes": "2025-01",
    "monto": 7500.50,
    "medio_pago": "Transferencia",
    "numero_comprobante": "TRF-001",
    "observaciones": "Pago enero",
    "fecha_pago": "2025-02-01",
    "creado_en": "2025-02-01T10:30:00Z"
  }
]
```

---

### 3. GET `/api/admin/sueldos/profesor/:id?mes=YYYY-MM`

**Obtiene detalles del cálculo para un profesor específico**

**Parámetros:**
- `:id` (path): ID del profesor
- `mes` (query): Mes en formato YYYY-MM

**Ejemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:3000/api/admin/sueldos/profesor/1?mes=2025-01"
```

**Respuesta:**
```json
{
  "profesor_id": 1,
  "profesor_nombre": "Juan Pérez",
  "porcentaje": 20,
  "mes": "2025-01",
  "clientes_detalle": [
    {
      "cliente_id": 10,
      "cliente_nombre": "Pedro González",
      "inscripcion_precio": 500,
      "estado_pago": "Pagado"
    }
  ],
  "clientes_pagos": 15,
  "monto_base": 7500,
  "monto_final": 1500,
  "estado": "Pendiente"
}
```

---

### 4. POST `/api/admin/sueldos/pago`

**Registra el pago de un sueldo**

**Body:**
```json
{
  "profesor_id": 1,
  "profesor_nombre": "Juan Pérez",
  "mes": "2025-01",
  "monto": 7500.50,
  "medio_pago": "Transferencia",
  "numero_comprobante": "TRF-001",
  "observaciones": "Pago mensual enero",
  "fecha": "2025-02-01"
}
```

**Validaciones:**
- ✅ `profesor_id`, `mes`, `monto`, `medio_pago` requeridos
- ✅ Mes debe estar en formato YYYY-MM
- ✅ Monto debe ser > 0
- ✅ No permite pagar 2 veces el mismo mes para un profesor
- ✅ Crea automáticamente egreso en movimientos

**Respuesta (201):**
```json
{
  "id": 1,
  "success": true,
  "message": "Sueldo registrado correctamente",
  "id_sueldo": 1,
  "id_profesor": 1,
  "mes": "2025-01",
  "monto": 7500.50,
  "medio_pago": "Transferencia",
  "numero_comprobante": "TRF-001",
  "observaciones": "Pago mensual enero",
  "fecha_pago": "2025-02-01",
  "creado_en": "2025-02-01T10:30:00Z"
}
```

---

## 🗄️ Cambios en Base de Datos

### Tabla Nueva: `sueldos_pagados`

```sql
CREATE TABLE sueldos_pagados (
  id_sueldo SERIAL PRIMARY KEY,
  id_profesor INTEGER NOT NULL,
  mes CHAR(7) NOT NULL,
  monto NUMERIC(12, 2) NOT NULL,
  medio_pago VARCHAR(50),
  numero_comprobante VARCHAR(100),
  observaciones TEXT,
  fecha_pago DATE NOT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_profesor FOREIGN KEY (id_profesor)
    REFERENCES profesores(id_profesor) ON DELETE RESTRICT,
  CONSTRAINT unique_profesor_mes UNIQUE(id_profesor, mes)
);
```

### Columna Nueva: `profesores.porcentaje_p`

```sql
ALTER TABLE profesores ADD COLUMN porcentaje_p NUMERIC(5, 2) DEFAULT 0;
```

### Índices Creados

```sql
CREATE INDEX idx_sueldos_mes ON sueldos_pagados(mes);
CREATE INDEX idx_sueldos_profesor ON sueldos_pagados(id_profesor);
CREATE INDEX idx_sueldos_fecha ON sueldos_pagados(fecha_pago DESC);
```

### Categoría en Movimientos

Se crea automáticamente la categoría "Sueldo" de tipo "Egreso" en `categorias_movimiento` si no existe.

---

## 🔐 Autenticación y Autorización

✅ Todos los endpoints requieren:
- Token JWT válido en header `Authorization: Bearer TOKEN`
- Rol: `Administrador`

---

## 📝 Lógica de Cálculo

### Obtener clientes pagos
```sql
SELECT DISTINCT clientes en horarios del profesor
WHERE suscripción pagada = true
  AND suscripción activa en el mes
```

### Sumar precios
```
suma = SUM(precio de cada cliente)
```

### Aplicar porcentaje
```
monto_final = suma × (porcentaje / 100)
```

### Ejemplo
```
Profesor: Juan Pérez
Porcentaje: 20%
Clientes pagos: 15
Precio promedio: $500

suma = 15 × 500 = $7.500
monto_final = $7.500 × (20 ÷ 100) = $1.500
```

---

## 🔗 Integración con Movimientos

Cuando se registra un pago de sueldo:

1. Se inserta en tabla `sueldos_pagados`
2. Se crea automáticamente un egreso en tabla `movimientos` con:
   - `tipo_m`: "Egreso"
   - `categoria`: "Sueldo"
   - `monto_m`: El monto del sueldo
   - `descripcion_m`: "Sueldo {nombre} - {mes}"
   - `medio_pago_m`: Según seleccionado
   - `origen_m`: "Sueldo"

Esto significa que aparecerá automáticamente en:
- Gastos → Movimientos
- Gastos → Gráficos
- Gastos → Balance mensual

---

## 🧪 Testing

### Test con curl

```bash
# 1. Obtener token (login)
TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"dni":12345678,"contrasena":"password"}' | jq -r '.token')

# 2. Obtener sueldos del mes
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/admin/sueldos?mes=2025-01"

# 3. Obtener detalles de profesor
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/admin/sueldos/profesor/1?mes=2025-01"

# 4. Registrar pago
curl -X POST http://localhost:3000/api/admin/sueldos/pago \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profesor_id": 1,
    "profesor_nombre": "Juan Pérez",
    "mes": "2025-01",
    "monto": 7500.50,
    "medio_pago": "Transferencia",
    "numero_comprobante": "TRF-001",
    "observaciones": "Pago enero",
    "fecha": "2025-02-01"
  }'
```

---

## ⚠️ Consideraciones Importantes

### 1. Permisos
- Solo `Administrador` puede acceder a sueldos
- Cualquier intento sin permisos retorna 401/403

### 2. Validaciones
- El mes debe ser válido (YYYY-MM)
- No permite pagar 2 veces el mismo mes
- El monto debe ser > 0

### 3. Datos
- Los clientes se cuentan solo si tienen suscripción pagada
- La suscripción debe estar activa en el mes
- El cliente debe estar activo (activo_c = true)

### 4. Transacciones
- El pago se registra en una transacción atómica
- Si algo falla, se revierte TODO (sueldo + movimiento)

---

## 📞 Troubleshooting

### Error: "Tabla no existe"
- Reinicia el servidor: `npm start`
- El script `init_sueldos.js` se ejecutará automáticamente

### Error: "Unique violation"
- Ya existe un pago para ese profesor en ese mes
- Verifica en `sueldos_pagados` antes de intentar pagar

### Error: "Categoría Sueldo no encontrada"
- Reinicia el servidor o ejecuta: `node scripts/init_sueldos.js`
- La categoría se crea automáticamente

### Sueldos en $0
- Verifica que el profesor tenga porcentaje configurado
- Verifica que haya clientes pagos en sus horarios ese mes
- Revisa tabla `suscripciones` y columna `pago_s`

---

## 🚀 Deploy

1. **Desarrollo:**
   ```bash
   npm start
   ```

2. **Producción:**
   - Asegurate de tener variables de entorno correctas en `.env`
   - La inicialización se ejecuta automáticamente
   - Verifica logs en startup

---

## 📊 Estructura de datos

```
Profesor
  ├── id_profesor
  ├── porcentaje_p (%)
  ├── nomap_p (nombre)
  └── [Horarios]
      └── [Clientes]
          └── [Suscripciones pagadas]
              └── [Precio]

Sueldo = SUM(Precio) × (Porcentaje / 100)
```

---

**Estado:** ✅ BACKEND COMPLETADO
**Última actualización:** 2026-08-26
