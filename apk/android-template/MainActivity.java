package in.growthapex.ems;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

// Requests location permission on first launch so the EMS website's check-in/out
// (navigator.geolocation) can read the phone's real GPS location.
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    String[] perms = {
      Manifest.permission.ACCESS_FINE_LOCATION,
      Manifest.permission.ACCESS_COARSE_LOCATION
    };
    boolean need = false;
    for (String p : perms) {
      if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) need = true;
    }
    if (need) ActivityCompat.requestPermissions(this, perms, 1001);
  }
}
