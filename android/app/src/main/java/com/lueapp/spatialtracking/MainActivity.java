package com.lueapp.spatialtracking;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BarometerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
