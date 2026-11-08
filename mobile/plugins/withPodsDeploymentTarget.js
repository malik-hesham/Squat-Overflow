// Xcode 27 refuses pod targets whose iOS deployment target is below 15.0, and a
// few pods' resource-bundle targets still declare 12.4 / 13.4. Raise every pod
// target to the app's deployment target after `pod install`.
const { withDangerousMod } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');
const fs = require('fs');
const path = require('path');

module.exports = function withPodsDeploymentTarget(config, { deploymentTarget = '16.4' } = {}) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');
      const result = mergeContents({
        tag: 'squat-overflow-pods-deployment-target',
        src: contents,
        newSrc: [
          '    installer.pods_project.targets.each do |target|',
          '      target.build_configurations.each do |build|',
          `        if build.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${deploymentTarget}`,
          `          build.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${deploymentTarget}'`,
          '        end',
          '      end',
          '    end',
        ].join('\n'),
        anchor: /post_install do \|installer\|/,
        offset: 1,
        comment: '#',
      });
      fs.writeFileSync(podfile, result.contents);
      return cfg;
    },
  ]);
};
