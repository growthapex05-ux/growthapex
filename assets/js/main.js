/*=== Javascript function indexing hear===========

01.gsapAnimationImageRevel();
02.gsapScrollingText();
03.gsapAnimationImageScale();
04.serviceHoverImageRevel();
05.imageParalax();
06.swiperActivation();
07.tiltAnimation();
08.wowActive();
09.progressAvtivation();
10.counterUp();
11.radialProgress();
12.titleSkewUp();
13.scrollDiwnCircle();
14.bannerBgVideo();
15.textTitleAnimation__1();
16.counterJumpanimation();
17.featureJumpanimation();
18.paragraphBodyAnimation();
19.slideUpSkew();
20.slideUp();
21.slideLeft();
22.slideRight();
23.buttonMoveAnimation();
24.teamAnimation();
25.showRightRevel();
26.caseVarticleScroll();
27.titleOpacityWrap();
28.magicCoursor();
29.portfolioTenSwiper();
30.offcanvasMenu();
31.preloaderWithBannerActivation();
32.isotopeMasonry();
33.stickySidebar();
34.backToTopInit();
35.stickyHeader();
36.countDown();
37.rollingText();

==================================================*/

(function ($) {
  'use strict';
  let device_width = window.innerWidth;
  $.exists = function (selector) {
    return $(selector).length > 0;
  };

  gsap.registerPlugin(ScrollTrigger, SplitText);

  var rdJs = {
    m: function (e) {
      rdJs.d();
      rdJs.methods();
    },
    d: function (e) {
      this._window = $(window),
        this._document = $(document),
        this._body = $('body'),
        this._html = $('html')
    },
    methods: function (e) {
      if (typeof rdJs.swiperActivation === "function") rdJs.swiperActivation();
      if (typeof rdJs.wowActive === "function") rdJs.wowActive();
      if (typeof rdJs.odoMeter === "function") rdJs.odoMeter();
      if (typeof rdJs.searchOption === "function") rdJs.searchOption();
      if (typeof rdJs.stickyHeader === "function") rdJs.stickyHeader();
      if (typeof rdJs.title_animation === "function") rdJs.title_animation();
      if (typeof rdJs.typing_text_animation === "function") rdJs.typing_text_animation();
      if (typeof rdJs.splitText === "function") rdJs.splitText();
      if (typeof rdJs.skew_up === "function") rdJs.skew_up();
      if (typeof rdJs.textTitleAnimation__1 === "function") rdJs.textTitleAnimation__1();
      if (typeof rdJs.gsapAnimationImageScale === "function") rdJs.gsapAnimationImageScale();
      if (typeof rdJs.feedbackCollupsShow === "function") rdJs.feedbackCollupsShow();
      if (typeof rdJs.imageSlideGsap === "function") rdJs.imageSlideGsap();
      if (typeof rdJs.imageParalax === "function") rdJs.imageParalax();
      if (typeof rdJs.sideMenu === "function") rdJs.sideMenu();
      if (typeof rdJs.metismenu === "function") rdJs.metismenu();
      if (typeof rdJs.preloader === "function") rdJs.preloader();
      if (typeof rdJs.goTop === "function") rdJs.goTop();
      if (typeof rdJs.tab_content_animation === "function") rdJs.tab_content_animation();
      if (typeof rdJs.smoothScroll === "function") rdJs.smoothScroll();
      if (typeof rdJs.slice_slider === "function") rdJs.slice_slider();
      if (typeof rdJs.text_highlight === "function") rdJs.text_highlight();
      if (typeof rdJs.showRightRevel === "function") rdJs.showRightRevel();
      if (typeof rdJs.scrollingText === "function") rdJs.scrollingText();
      if (typeof rdJs.scrollingText2 === "function") rdJs.scrollingText2();
      if (typeof rdJs.awardAccordion === "function") rdJs.awardAccordion();
      if (typeof rdJs.containerResize === "function") rdJs.containerResize();
      if (typeof rdJs.featureProjectHover === "function") rdJs.featureProjectHover();
      if (typeof rdJs.delayStatsProgress === "function") rdJs.delayStatsProgress();
    },

    sideMenu: function () {
      if ($("#menu-btn").length) {
        $("#menu-btn").on("click", function () {
          $("#side-bar").toggleClass("show");
        });
      }
    },
    metismenu: function () {
      if ($("#mobile-menu").length && $.fn.metisMenu) {
        $("#mobile-menu").metisMenu();
      }
    },

    swiperActivation: function () {

      $(document).ready(function () {
        var bgSwiper = new Swiper(".bg-slider", {
          slidesPerView: 1,
          autoplay: {
            delay: 4000,
            disableOnInteraction: false
          },
          loop: true,
          spaceBetween: 0,
          effect: "creative",
          speed: 1500,
          navigation: {
            nextEl: ".swiper-btn-next",
            prevEl: ".swiper-btn-prev",
          },
          creativeEffect: {
            prev: {
              scale: 1.1,
              opacity: 0,
              translate: [0, 0, 0],
            },
            next: {
              scale: 1.3,
              opacity: 0,
              translate: [0, 0, 0],
            },
          },
        });
      });

      $(document).ready(function () {

        var imageSwiper = new Swiper(".testimonials-image-slider", {
          slidesPerView: 1,
          slidesPerGroup: 1,
          spaceBetween: 0,
          speed: 1800,
          loop: true,
          autoplay: {
            delay: 1000,
            disableOnInteraction: false
          },
          navigation: {
            nextEl: ".swiper-btn-next",
            prevEl: ".swiper-btn-prev",
          },
        });

        var contentSwiper = new Swiper(".testimonials-content-slider", {
          slidesPerView: 1,
          spaceBetween: 0,
          effect: 'fade',
          speed: 1800,
          loop: true,
          autoplay: false,
          fadeEffect: {
            crossFade: true
          }
        });

        // 🔗 control each other
        imageSwiper.controller.control = contentSwiper;
        contentSwiper.controller.control = imageSwiper;

      });
      $(document).ready(function () {

        var imageSwiper = new Swiper(".project-slider", {
          slidesPerView: 1,
          slidesPerGroup: 1,
          spaceBetween: 0,
          speed: 1300,
          loop: false,
          autoplay: false,
          navigation: {
            nextEl: ".slider-next",
            prevEl: ".slider-prev",
          },
        });

      });
      $(document).ready(function () {
        var projectSwiper = new Swiper(".portfolio-slider", {
          slidesPerView: 1,
          slidesPerGroup: 1,
          centeredSlides: true,
          spaceBetween: 0,
          speed: 1800,
          loop: true,
          // autoplay: {
          //   delay: 5000,
          //   disableOnInteraction: false
          // },
          navigation: {
            nextEl: ".swiper-btn-next",
            prevEl: ".swiper-btn-prev",
          },
        });
      });

    },
    wowActive: function () {
      new WOW().init();
    },
    featureProjectHover: function () {
      const boxes = document.querySelectorAll('.feature-project');
      if (!boxes.length) return;

      boxes.forEach(box => {
        const hoverElement = box.querySelector('.hover_mouse');
        if (!hoverElement) return;

        box.addEventListener('mousemove', function (event) {
          const boxRect = box.getBoundingClientRect();
          const mouseX = event.clientX - boxRect.left;
          const mouseY = event.clientY - boxRect.top;

          hoverElement.style.transform = `translate3d(${mouseX - 50}px, ${mouseY - 50}px, 0)`;
          hoverElement.classList.add('active');
        });

        box.addEventListener('mouseleave', function () {
          hoverElement.classList.remove('active');
        });
      });
    },
    delayStatsProgress: function () {
      const progressBars = document.querySelectorAll('.wpr-delay-stats-area .delay-stats-fill[data-progress]');
      if (!progressBars.length) return;

      const clampValue = (value) => Math.min(100, Math.max(0, value));

      const fillProgressBars = () => {
        progressBars.forEach((bar) => {
          const raw = Number(bar.getAttribute('data-progress'));
          const value = clampValue(Number.isNaN(raw) ? 0 : raw);
          const pctLabel = bar.querySelector('.pct');
          bar.style.width = value + '%';
          if (value > 0) {
            bar.style.minWidth = '92px';
          }
          bar.setAttribute('aria-valuenow', String(value));
          if (pctLabel) pctLabel.textContent = value + '%';
        });
      };

      // Animate only when the section is visible.
      if ('IntersectionObserver' in window) {
        const section = document.querySelector('.wpr-delay-stats-area');
        if (!section) {
          fillProgressBars();
          return;
        }
        const observer = new IntersectionObserver((entries, obs) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              fillProgressBars();
              obs.unobserve(entry.target);
            }
          });
        }, { threshold: 0.3 });
        observer.observe(section);
      } else {
        fillProgressBars();
      }
    },
    preloader: function () {
      if ($(".preloader").length) {
        var innerBars = document.querySelectorAll(".inner-bar");
        var increment = 0;
        var hasAnimated = false;

        function hidePreloader() {
          if ($(".preloader").length) {
            gsap.to(".preloader", {
              "--preloader-clip": "100%",
              opacity: 0,
              duration: 0.3,
              ease: "none",
              onComplete: function () {
                $(".preloader").remove();
              },
            });
          }
        }

        // Safety fallback: guaranteed preloader removal after 1.2s max
        setTimeout(function () {
          hidePreloader();
        }, 1200);

        function animateBars() {
          if (hasAnimated) return;
          hasAnimated = true;

          if (!innerBars || !innerBars.length) {
            hidePreloader();
            return;
          }

          for (var i = 0; i < 2; i++) {
            if (innerBars[i + increment]) {
              var randomWidth = Math.floor(Math.random() * 101);
              gsap.to(innerBars[i + increment], {
                width: randomWidth + "%",
                duration: 0.3,
                ease: "none",
              });
            }
          }

          gsap.delayedCall(0.3, function () {
            for (var i = 0; i < 2; i++) {
              if (innerBars[i + increment]) {
                gsap.to(innerBars[i + increment], {
                  width: "100%",
                  duration: 0.3,
                  ease: "none",
                });
              }
            }

            increment += 2;

            if (increment < innerBars.length) {
              animateBars();
            } else {
              hidePreloader();
            }
          });
        }

        if (document.readyState === "complete" || document.readyState === "interactive") {
          animateBars();
        } else {
          $(window).on("load", function () {
            animateBars();
          });
        }
      }
    },
    goTop: function () {
    if ($("#goTop").length) {
        var $goTop = $("#goTop");
        var $borderProgress = $(".border-progress");
        var $footer = $(".tf-footer");

        $(window).on("scroll", function () {
            var scrollTop = $(window).scrollTop();
            var docHeight = $(document).height() - $(window).height();
            var scrollPercent = (scrollTop / docHeight) * 100;
            var progressAngle = (scrollPercent / 100) * 360;

            $borderProgress.css("--progress-angle", progressAngle + "deg");

            var windowBottom = scrollTop + $(window).height();
            var hasFooter = $footer.length > 0;
            var footerPosition = hasFooter ? $footer.offset() : null;
            var footerOffset = footerPosition ? footerPosition.top : Infinity;

            if (scrollTop > 100 && windowBottom < footerOffset) {
                $goTop.addClass("show");
            } else {
                $goTop.removeClass("show");
            }
        });

        $goTop.on("click", function () {
            $("html, body").animate({ scrollTop: 0 }, 100);
        });
    } else {

    }
},
    // search popup
    searchOption: function () {
      $(document).on('click', '#search', function () {
        $(".search-input-area").addClass("show");
        $("#anywhere-home").addClass("bgshow");
      });
      $(document).on('click', '#close', function () {
        $(".search-input-area").removeClass("show");
        $("#anywhere-home").removeClass("bgshow");
      });
      $(document).on('click', '#anywhere-home', function () {
        $(".search-input-area").removeClass("show");
        $("#anywhere-home").removeClass("bgshow");
      });
    },
    odoMeter: function () {
      $(document).ready(function () {
        function isInViewport(element) {
          const rect = element.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
          );
        }

        function triggerOdometer(element) {
          const $element = $(element);
          if (!$element.hasClass('odometer-triggered')) {
            const countNumber = $element.attr('data-count');
            $element.html(countNumber);
            $element.addClass('odometer-triggered'); // Add a class to prevent re-triggering
          }
        }

        function handleOdometer() {
          $('.odometer').each(function () {
            if (isInViewport(this)) {
              triggerOdometer(this);
            }
          });
        }

        // Check on page load
        handleOdometer();

        // Check on scroll
        $(window).on('scroll', function () {
          handleOdometer();
        });
      });
    },
    // sticky header activation
    stickyHeader: function (e) {
      $(window).scroll(function () {
        if ($(this).scrollTop() > 150) {
          $('.header--sticky').addClass('sticky')
        } else {
          $('.header--sticky').removeClass('sticky')
        }
      })
    },
    imageSlideGsap: function () {
      $(document).ready(function () {
        gsap.to(".images", {
          scrollTrigger: {
            // trigger: ".images",
            start: "top bottom",
            end: "bottom top",
            scrub: 1,
            // markers: true
          },
          x: -250,
        })
      });
      $(document).ready(function () {
        gsap.to(".images-r", {
          scrollTrigger: {
            // trigger: ".images",
            start: "top bottom",
            end: "bottom top",
            scrub: 1,
            // markers: true
          },
          x: 250,
        })
      });
      $(document).ready(function () {
        gsap.to(".images-2", {
          scrollTrigger: {
            // trigger: ".images",
            start: "top bottom",
            end: "bottom top",
            scrub: 1,
            // markers: true
          },
          y: -290,
        })
      });
    },

    title_animation: function () {

      gsap.registerPlugin(ScrollTrigger);
      gsap.registerPlugin(SplitText);
      if (window.innerWidth > 768) {
        $(document).ready(function () {
          let addAnimation = function () {
            $(".split-collab").each(function (index) {
              const textInstance = $(this);
              const text = new SplitText(textInstance, {
                type: "chars",
              });

              let letters = text.chars;

              let tl = gsap.timeline({
                scrollTrigger: {
                  trigger: textInstance,
                  start: "top 85%",
                  end: "top 85%",
                  onComplete: function () {
                    textInstance.removeClass(".split-collab");
                  }
                }
              });

              tl.set(textInstance, { opacity: 1 }).from(letters, {
                duration: .5,
                autoAlpha: 0,
                x: 50,
                // scaleY: 0,
                // skewX: 50,
                stagger: { amount: 1 },
                ease: "back.out(1)"
              });
            });
          };

          addAnimation();

          window.addEventListener("resize", function (event) {
            if ($(window).width() >= 992) {
              addAnimation();
            }
          });

        });
      }

    },
    tab_content_animation: function () {
      gsap.registerPlugin(ScrollTrigger);

      $(document).ready(function () {
        const tabs = document.querySelectorAll('[data-bs-toggle="tab"]');

        // Animate tab content
        function animateTabContent(targetPane) {
          const items = targetPane.querySelectorAll(".working-process-wrapper");
          if (!items.length) return;

          gsap.fromTo(
            items,
            { opacity: 0, y: 30 },
            {
              opacity: 1,
              y: 0,
              duration: 0.7,
              ease: "power2.out"
            }
          );
        }

        // ✅ Instantly clean up when tab is about to change
        tabs.forEach((tab) => {
          tab.addEventListener("show.bs.tab", function () {
            document.querySelectorAll(".tab-pane").forEach((pane) => {
              pane.classList.remove("active", "show");
            });
          });

          tab.addEventListener("shown.bs.tab", function (event) {
            const targetSelector = event.target.getAttribute("data-bs-target");
            const targetPane = document.querySelector(targetSelector);
            animateTabContent(targetPane);
          });
        });

        // Animate first active tab on load
        const firstActivePane = document.querySelector(".tab-pane.active.show");
        if (firstActivePane) animateTabContent(firstActivePane);
      });
    },
    scrollingText: function () {
      $(document).ready(function () {
        let el = document.getElementsByClassName('scrollingtext-1');
        if (el.length) {

          gsap.registerPlugin(ScrollTrigger);

          // Scroll-reactive movement only
          gsap.to('.scrollingtext-1', {
            xPercent: 2,           // scroll অনুযায়ী কত movement হবে
            scrollTrigger: {
              trigger: '.scrollingtext-1', // scroll trigger
              start: "top bottom",
              end: "bottom top",
              scrub: 1                 // smooth animation
            },
            ease: "none"
          });
        }
      });
    },
    scrollingText2: function () {
      $(document).ready(function () {
        let el = document.getElementsByClassName('scrollingtext-2');
        if (el.length) {

          gsap.registerPlugin(ScrollTrigger);

          // Scroll-reactive movement only (বামে)
          gsap.to('.scrollingtext-2', {
            xPercent: -10,          // scroll অনুযায়ী move left
            scrollTrigger: {
              trigger: '.scrollingtext-2',  // scroll trigger
              start: "top bottom",
              end: "bottom top",
              scrub: 1                     // smooth scroll
            },
            ease: "none"
          });
        }
      });
    },
    typing_text_animation: function () {
      gsap.registerPlugin(ScrollTrigger, SplitText);

      if (window.innerWidth > 768) {
        $(document).ready(function () {
          const textElem = $(".typing_text");
          if (textElem.length === 0) return;

          const split = new SplitText(textElem, { type: "chars" });
          const chars = split.chars;

          gsap.set(chars, { opacity: 0 });

          gsap.to(chars, {
            opacity: 1,
            ease: "none",
            stagger: 0.1, // fade-in gap between letters, adjust as needed
            scrollTrigger: {
              trigger: ".section-typing_text",
              start: "top bottom",
              end: "bottom bottom",
              scrub: true,
              markers: true
            }
          });
        });
      }
    },

    splitText: function (e) {
      if ($('.wpr-text-anime-style-1').length) {
        let animatedTextElements = document.querySelectorAll('.wpr-text-anime-style-1');

        animatedTextElements.forEach((element) => {
          //Reset if needed
          if (element.animation) {
            element.animation.progress(1).kill();
            element.split.revert();
          }

          element.split = new SplitText(element, {
            type: "lines,words,chars",
            linesClass: "split-line",
          });
          gsap.set(element, { perspective: 400 });

          gsap.set(element.split.chars, {
            opacity: 0,
            x: "50",
          });

          element.animation = gsap.to(element.split.chars, {
            scrollTrigger: { trigger: element, start: "top 95%" },
            x: "0",
            y: "0",
            rotateX: "0",
            opacity: 1,
            duration: 1,
            ease: Back.easeOut,
            stagger: 0.02,
          });
        });
      }
    },

    skew_up: function () {
      gsap.registerPlugin(SplitText);
      if (window.innerWidth > 768) {

        $(document).ready(function () {
          let addAnimation = function () {
            $(".skew-up").each(function (index) {
              const text = new SplitType($(this), {
                types: "lines, words",
                lineClass: "word-line"
              }); let textInstance = $(this);
              let line = textInstance.find(".word-line");
              let word = line.find(".word"); let tl = gsap.timeline({
                scrollTrigger: {
                  trigger: textInstance,
                  start: "top 85%",
                  end: "top 85%",
                  onComplete: function () {
                    $(textInstance).removeClass("skew-up");
                  }
                }
              });
              tl.set(textInstance, { opacity: 1 }).from(word, {
                y: "100%",
                skewX: "-5",
                duration: 2,
                stagger: 0.09,
                ease: "expo.out"
              });
            });
          };
          addAnimation(); window.addEventListener("resize", function (event) {
            if ($(window).width() >= 992) { addAnimation(); }
          });
        });
      }

      if (window.innerWidth > 768) {
        $(document).ready(function () {
          let addAnimation = function () {
            $(".skew-up-2").each(function (index) {
              const textInstance = $(this);
              const text = new SplitText(textInstance, {
                type: "chars",
              });

              let letters = text.chars;

              let tl = gsap.timeline({
                scrollTrigger: {
                  trigger: textInstance,
                  start: "top 85%",
                  end: "top 85%",
                  onComplete: function () {
                    textInstance.removeClass("skew-up-2");
                  }
                }
              });

              tl.set(textInstance, { opacity: 1 }).from(letters, {
                duration: .4,
                autoAlpha: 0,
                y: 50,
                // scaleX: 0,
                // skewX: 50,
                stagger: { amount: 1 },
                ease: "back.out(0)"
              });
            });
          };

          addAnimation();

          window.addEventListener("resize", function (event) {
            if ($(window).width() >= 992) {
              addAnimation();
            }
          });

        });
      }
    },
    gsapAnimationImageScale: function (e) {
      $(document).ready(function () {

        let growActive = document.getElementsByClassName('grow');
        if (growActive.length) {
          const growTl = gsap.timeline({
            scrollTrigger: {
              trigger: ".grow",
              scrub: 1,
              start: "top center",
              end: "+=1000",
              ease: "power1.out"
            }
          });
          growTl.to(".grow", {
            duration: 1,
            scale: 1
          });
        }

      });

    },
    textTitleAnimation__1: function () {
      if (window.innerWidth > 650) {

        const quotes = document.querySelectorAll(".quote");
        const quotes2 = document.querySelectorAll(".quote-2");

        function setupSplits() {
          $(document).ready(function () {
            $(".split-line").wrap('<div class="split-parent"></div>');
          });


          quotes.forEach(quote => {

            quote.split = new SplitText(quote, {
              type: "lines,words,chars",
              linesClass: "split-line"
            });

            // Set up the anim
            quote.anim = gsap.from(quote.split.lines, {
              scrollTrigger: {
                trigger: quote,
                toggleActions: "play none none none",
                once: true,
                start: "bottom 100%",
                markers: true,
              },
              duration: 0.6,
              delay: 0.3,
              ease: "circ.out",
              yPercent: 100,
              stagger: 0.2,
            });
          });



          quotes2.forEach(quote2 => {

            quote2.split = new SplitText(quote2, {
              type: "lines"
            });

            // Set up the anim
            quote2.anim = gsap.from(quote2.split.lines, {
              scrollTrigger: {
                trigger: quote2,
                toggleActions: "play none none none",
                once: true,
                start: "50% 60%",
                markers: true,
              },
              duration: 0.6,
              autoAlpha: 0,
              ease: "circ.out",
              yPercent: 100,
              stagger: 0.2,
            });
          });
        }

        // ScrollTrigger.addEventListener("refresh", setupSplits);
        setupSplits();
      }



    },
    text_highlight: function () {
      const highlights = document.querySelectorAll(".title-highlight");
      if (!highlights.length) return;

      highlights.forEach((el) => {
        const highlightText = new SplitText(el, {
          type: "lines",
          linesClass: "line",
        });

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: el,
            scrub: 2,
            start: "top 70%",
            end: "bottom 40%",
          },
        });

        tl.to(highlightText.lines, {
          "--highlight-offset": "100%",
          stagger: 0.5,
          duration: 2,
          ease: "power2.out",
        });
      });
    },
    showRightRevel: function () {
      let hoverTab = document.getElementsByClassName('wpr-hover-tab');
      if (hoverTab.length) {

        $(".wpr-hover-tab").on("mouseenter", function () {
          $(this).addClass("active").siblings().removeClass("active");
        }),

          gsap.utils.toArray(".wpr-show-revel-right").forEach((e) => {
            gsap.set(e, {
              opacity: 0,
              y: 100
            }),
              gsap.to(e, {
                scrollTrigger: {
                  trigger: e,
                  start: "top 90%",
                  end: "bottom 60%",
                  markers: !1
                },
                opacity: 1,
                y: -0,
                ease: "power2.out",
                duration: 1,
                stagger: 0.3
              });
          });
      };

    },

    feedbackCollupsShow: function () {

      // feedback button click show start
      document.addEventListener('DOMContentLoaded', function () {
        var rdBtn = document.querySelector('.button-area-box-shadow .wpr-btn');
        var overlaySection = document.querySelector('.overlay-bottom-section');
        var isToggled = false;

        if (rdBtn && overlaySection) {
          rdBtn.addEventListener('click', function () {
            if (!isToggled) {
              // Change margin of .wpr-btn
              rdBtn.style.margin = '0px auto 0 auto';
              rdBtn.innerHTML = 'View less feedbacks';
              // Remove the overlay-bottom-section class
              overlaySection.classList.remove('overlay-bottom-section');
            } else {
              // Revert margin of .wpr-btn
              rdBtn.style.margin = '';
              rdBtn.innerHTML = 'View all feedbacks';

              // Add the overlay-bottom-section class back
              overlaySection.classList.add('overlay-bottom-section');
            }

            // Toggle the state
            isToggled = !isToggled;
          });
        }
      });
      // feedback button click show End
    },

    imageParalax: function () {

      $(document).ready(function () {
        let paralax = document.getElementsByClassName('anim-image-parallax');
        if (paralax.length) {
          $(".anim-image-parallax").each(function () {

            // Add wrap <div>.
            $(this).wrap('<div class="anim-image-parallax-wrap"><div class="anim-image-parallax-inner"></div></div>');

            // Add overflow hidden.
            $(".anim-image-parallax-wrap").css({
              "overflow": "hidden"
            });

            var $animImageParallax = $(this);
            var $aipWrap = $animImageParallax.parents(".anim-image-parallax-wrap");
            var $aipInner = $aipWrap.find(".anim-image-parallax-inner");

            // Parallax
            gsap.to($animImageParallax, {
              yPercent: 80,
              ease: "none",
              scrollTrigger: {
                trigger: $aipWrap,
                start: "top bottom",
                end: "bottom top",
                scrub: true,
                markers: false,
              },
            });

            // Zoom in
            let tl_aipZoomIn = gsap.timeline({
              scrollTrigger: {
                trigger: $aipWrap,
                start: "top 90%",
                markers: false,
              }
            });
            tl_aipZoomIn.from($aipInner, {
              duration: 1.5,
              autoAlpha: 0,
              scale: 1.4,
              ease: Power2.easeOut,
              clearProps: "all"
            });

          });
        };
      })

      $(document).ready(function () {
        let paralax = document.getElementsByClassName('anim-image-parallax-2');
        if (paralax.length) {
          $(".anim-image-parallax-2").each(function () {
            // Add wrap <div>.
            $(this).wrap('<div class="anim-image-parallax-wrap"><div class="anim-image-parallax-inner"></div></div>');

            // Add overflow hidden.
            $(".anim-image-parallax-wrap").css({
              "overflow": "hidden"
            });
            var $animImageParallax = $(this);
            var $aipWrap = $animImageParallax.parents(".anim-image-parallax-wrap");
            var $aipInner = $aipWrap.find(".anim-image-parallax-inner");

            // Parallax
            gsap.to($animImageParallax, {
              yPercent: 20,
              ease: "none",
              scrollTrigger: {
                trigger: $aipWrap,
                start: "top bottom",
                end: "bottom top",
                scrub: true,
                markers: false,
              },
            });

            // Zoom in
            let tl_aipZoomIn = gsap.timeline({
              scrollTrigger: {
                trigger: $aipWrap,
                start: "top 90%",
                markers: false,
              }
            });
            tl_aipZoomIn.from($aipInner, {
              duration: 1.5,
              autoAlpha: 0,
              scale: 1.4,
              ease: Power2.easeOut,
              clearProps: "all"
            });

          });
        };
      })


    },

    // side menu desktop
    // side menu desktop
    sideMenu: function () {
      $(document).on('click', '#menu-btn', function () {
        $("#side-bar").toggleClass("show");
        $("#anywhere-home").toggleClass("bgshow");
        $(this).toggleClass("cross"); // 👈 menu-btn এ cross class
      });

      $(document).on('click', '.close-icon-menu, #anywhere-home, .onepage .mainmenu li a', function () {
        $("#side-bar").removeClass("show");
        $("#anywhere-home").removeClass("bgshow");
        $("#menu-btn").removeClass("cross"); // 👈 cross remove
      });
    },


    smoothScroll: function (e) {
      $(document).on('click', '.onepage a[href^="#"]', function (event) {
        event.preventDefault();

        const target = $.attr(this, 'href');

        // prevent error if href is just "#"
        if (target.length > 1 && $(target).length) {
          $('html, body').animate({
            scrollTop: $(target).offset().top
          }, 300);
        }
      });
    },

    awardAccordion: function () {
      const projectBlocks = document.querySelectorAll('.award-item');

      projectBlocks.forEach(block => {
        block.addEventListener('click', function () {

          // if already active then remove it
          if (this.classList.contains('active')) {
            this.classList.remove('active');
          } else {
            // remove active from all
            projectBlocks.forEach(b => b.classList.remove('active'));

            // add active to clicked
            this.classList.add('active');
          }

        });
      });
    },
    metismenu: function () {
      $('#mobile-menu-active').metisMenu();
    },
    slice_slider: function () {
      // Slice Constructor
      var Slice = function (element) {
        var sliceDiv = element;
        var gridX = 4;
        var w = sliceDiv.offsetWidth;
        var h = sliceDiv.offsetHeight;
        var img = sliceDiv.querySelector("img").src;
        var delay = 0.05;

        this.create = function () {
          for (let x = 0; x < gridX; x++) {
            var width = (x * w) / gridX + "px";
            var div = document.createElement("span");
            div.className = "slice-part";
            sliceDiv.appendChild(div);
            div.style.left = width;
            div.style.top = 0;
            div.style.width = w / gridX + "px";
            div.style.height = h + "px";
            div.style.backgroundImage = "url(" + img + ")";
            div.style.backgroundPosition = "-" + width + " 0";
            div.style.backgroundSize = w + "px auto";
            div.style.transitionDelay = x * delay + "s";
          }
        };

        this.create();
      };

      // Create slices on window load
      window.addEventListener("load", function () {
        var sliceElements = document.querySelectorAll(".slice");
        sliceElements.forEach(function (el) {
          new Slice(el);
        });
      });

      // Image slider logic
      const rwdSliderImages = document.querySelectorAll(".wpr-image-slider .slice");

      if (rwdSliderImages?.length) {
        let index = 0;

        function showNextImage() {
          rwdSliderImages.forEach(slice => slice.classList.remove("active"));
          rwdSliderImages[index].classList.add("active");
          index = (index + 1) % rwdSliderImages.length;
        }

        // Initial display
        showNextImage();
        setInterval(showNextImage, 2000);
      }
    },
    containerResize: function () {
      document.addEventListener("DOMContentLoaded", function () {
        if (window.innerWidth <= 768) return;

        gsap.registerPlugin(ScrollTrigger);

        const pinWrap = document.querySelector(".wpr-video-pin");
        const wrapper = document.querySelector(".wpr-video-wrapper");
        const slideContents = wrapper?.querySelectorAll(".slide-content");
        const featureProjects = wrapper?.querySelectorAll(".feature-project");
        const swiperNav = wrapper?.querySelector(".swiper-navigation");

        if (
          !pinWrap ||
          !wrapper ||
          !slideContents.length ||
          !featureProjects.length ||
          !swiperNav
        )
          return;

        // ---------- INITIAL STATE ----------
        gsap.set(wrapper, {
          scale: 0.1,
          opacity: 0,
          transformOrigin: "center center",
          willChange: "transform, opacity",
        });

        gsap.set([...slideContents, swiperNav], {
          opacity: 0,
          willChange: "opacity",
        });

        gsap.set(featureProjects, {
          pointerEvents: "none",
        });

        // ---------- TIMELINE ----------
        gsap.timeline({
          scrollTrigger: {
            trigger: pinWrap,
            start: "top top",
            end: () => "+=" + window.innerHeight,
            scrub: 0.8,
            pin: true,
            pinSpacing: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        })
          .to(wrapper, {
            opacity: 1,
            duration: 0.25,
            ease: "power1.out",
          })
          .to(wrapper, {
            scale: 1,
            duration: 1.4,
            ease: "power2.out",
          })
          .to(
            [...slideContents, swiperNav],
            {
              opacity: 1,
              duration: 0.4,
              ease: "power1.out",
            },
            ">"
          )
          .to(
            featureProjects,
            {
              pointerEvents: "auto",
            },
            ">"
          );
      });
    },
  }
  rdJs.m();

  $(document).ready(function () {
    // Listen for the collapse show event
    $('.working-process-accordion-one .accordion-collapse').on('show.bs.collapse', function () {
      // Find the parent .accordion-item and add the 'show' class
      $(this).closest('.accordion-item').addClass('show');
    });

    // Listen for the collapse hide event
    $('.working-process-accordion-one .accordion-collapse').on('hide.bs.collapse', function () {
      // Find the parent .accordion-item and remove the 'show' class
      $(this).closest('.accordion-item').removeClass('show');
    });

  });


  $(document).ready(function () {
    $('#ce-toggle').change(function () {
      const isChecked = $(this).is(':checked');

      // Toggle active class based on checked state
      if (isChecked) {
        $('.plan-toggle-wrap').removeClass('active');
        $('#monthly').show();
        $('#yearly').hide();
      } else {
        $('.plan-toggle-wrap').addClass('active');
        $('#monthly').hide();
        $('#yearly').show();
      }
    });

    // Optional: Set initial state on page load
    $('#ce-toggle').trigger('change');
  });

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-bg-src]').forEach(function (el) {
      const bg = el.getAttribute('data-bg-src');
      if (bg) {
        el.style.backgroundImage = `url(${bg})`;
        el.style.backgroundSize = 'cover';        // Optional
        el.style.backgroundPosition = 'center';   // Optional
        el.style.backgroundRepeat = 'no-repeat';  // Optional
      }
    });
  });

  var win = $(window);
  var totop = $('.scroll-top-btn');
  win.on('scroll', function () {
    if (win.scrollTop() > 150) {
      totop.fadeIn();
    } else {
      totop.fadeOut();
    }
  });
  totop.on('click', function () {
    $("html,body").animate({
      scrollTop: 0
    }, 500)
  });




})(jQuery, window)  