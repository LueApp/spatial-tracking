package com.lueapp.spatialtracking;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the device barometer (Sensor.TYPE_PRESSURE) to the web layer — the one
 * altitude source a browser cannot reach. The barometer measures air pressure,
 * which tracks short-term vertical movement (elevators, stairs) far more precisely
 * than GPS (~0.1 m vs tens of meters). It has no absolute reference of its own
 * (weather shifts sea-level pressure), so the JS side fuses these readings with
 * GPS: barometer for fast relative change, GPS for the slow absolute level.
 *
 * Emits a "reading" event per sample with:
 *   pressure  – hPa (millibar)
 *   altitude  – meters above the standard-atmosphere reference (1013.25 hPa).
 *               The reference is constant, so successive differences are an
 *               accurate, drift-light relative-altitude signal regardless of it.
 *   timestamp – ms since epoch
 */
@CapacitorPlugin(name = "Barometer")
public class BarometerPlugin extends Plugin implements SensorEventListener {
    private SensorManager sensorManager;
    private Sensor pressureSensor;
    private boolean listening = false;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            pressureSensor = sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE);
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", pressureSensor != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (pressureSensor == null) {
            call.reject("No pressure sensor on this device");
            return;
        }
        if (!listening) {
            int delay = SensorManager.SENSOR_DELAY_NORMAL; // ~200 ms, battery-friendly
            String freq = call.getString("frequency", "normal");
            if ("ui".equals(freq)) {
                delay = SensorManager.SENSOR_DELAY_UI;     // ~60 ms, snappier for elevators
            } else if ("game".equals(freq)) {
                delay = SensorManager.SENSOR_DELAY_GAME;    // ~20 ms
            }
            sensorManager.registerListener(this, pressureSensor, delay);
            listening = true;
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        unregister();
        call.resolve();
    }

    private void unregister() {
        if (listening && sensorManager != null) {
            sensorManager.unregisterListener(this);
            listening = false;
        }
    }

    @Override
    protected void handleOnDestroy() {
        unregister();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_PRESSURE) {
            return;
        }
        float hpa = event.values[0];
        float altitude = SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, hpa);
        JSObject data = new JSObject();
        data.put("pressure", hpa);
        data.put("altitude", altitude);
        data.put("timestamp", System.currentTimeMillis());
        notifyListeners("reading", data);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // not used — pressure accuracy buckets aren't actionable here
    }
}
