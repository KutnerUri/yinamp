// Read-only permission probe. Never register an application or open a window.
#include <mach/mach.h>
#include <servers/bootstrap.h>
#include <stdio.h>

int main(void) {
  const char *services[] = {
    "com.apple.coreservices.launchservicesd",
    "com.apple.windowserver.active",
  };
  int denied = 0;
  for (unsigned i = 0; i < sizeof(services) / sizeof(services[0]); i++) {
    mach_port_t service = MACH_PORT_NULL;
    kern_return_t result = bootstrap_look_up(bootstrap_port, services[i], &service);
    if (result == BOOTSTRAP_NOT_PRIVILEGED) {
      fprintf(stderr, "%s: %s\n", services[i], bootstrap_strerror(result));
      denied = 1;
    }
    if (service != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), service);
  }
  // Only reject explicit permission denials. Service availability alone does not
  // prove GUI access, and an unknown service name should not reject a CI host.
  return denied ? 77 : 0;
}
